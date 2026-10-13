import "server-only"

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import type { Session, TaskProviderAdapter, Tokens } from "./core/adapter.ts"
import { backlinkFor } from "./core/content-ref.ts"
import type { Backlink, Connection, ContentRef, CreateTaskInput, Link, ProviderId } from "./core/types.ts"
import type { AgilityCaller } from "./agility/identity.ts"
import { createJiraAdapter } from "./providers/jira/adapter.ts"
import { createMockAdapter } from "./providers/mock/adapter.ts"
import { createMemoryStore } from "./store/memory.ts"
import { tableFromEnv } from "./store/table.ts"
import type { WorkStore } from "./store/store.ts"

/**
 * The service every route goes through: which provider, which store, and the flows (connect, link, create, unlink,
 * sync). Routes stay thin so a second provider app (Linear, Asana) reuses all of this unchanged.
 */

const env = (name: string) => {
	const v = process.env[name]
	if (!v) throw new Error(`${name} is not set (see .env.example).`)
	return v
}

/** This deployment's public origin, for the OAuth callback and the icons Jira shows: APP_URL, else App Service's host. */
export const appUrl = (): string => {
	const explicit = process.env.APP_URL
	if (explicit) return explicit.replace(/\/$/, "")
	if (process.env.WEBSITE_HOSTNAME) return `https://${process.env.WEBSITE_HOSTNAME}`
	return env("APP_URL")
}

export const providerId = (): ProviderId => (process.env.WORK_PROVIDER === "mock" ? "mock" : "jira")

let adapterSingleton: TaskProviderAdapter | undefined
export const adapter = (): TaskProviderAdapter =>
	(adapterSingleton ??=
		providerId() === "mock"
			? createMockAdapter()
			: createJiraAdapter({ clientId: env("ATLASSIAN_CLIENT_ID"), clientSecret: env("ATLASSIAN_CLIENT_SECRET"), appUrl: appUrl() }))

// Azure Table Storage when AZURE_TABLE_ACCOUNT is set (resource group agility.apps.jira, reached with the App Service's
// managed identity); in memory otherwise, which is only for local development and the mock provider. A real provider in
// production without a store is refused rather than left to lose every connection on restart. globalThis keeps the
// store across dev hot reloads.
const g = globalThis as unknown as { __workStore?: WorkStore }
export const store = (): WorkStore =>
	(g.__workStore ??=
		tableFromEnv() ??
		(process.env.NODE_ENV === "production" && providerId() !== "mock"
			? (() => {
					throw new Error("No store: set AZURE_TABLE_ACCOUNT (Azure Table Storage).")
				})()
			: createMemoryStore()))

// --- OAuth state: signed, short-lived, carries who started the connect -------------------------------------

const stateSecret = () => process.env.WORK_STATE_SECRET ?? env("WORK_TOKEN_KEY")

/** `admin`: an Agility admin authorizing the provider site for the whole instance. `user`: an editor connecting. */
export type ConnectPurpose = "admin" | "user"

export const signState = (caller: AgilityCaller, provider: ProviderId, purpose: ConnectPurpose = "user", site?: string): string => {
	const body = Buffer.from(
		JSON.stringify({ g: caller.instanceGuid, u: caller.userId, nm: caller.name, p: provider, k: purpose, s: site, n: randomUUID(), e: Date.now() + 10 * 60_000 })
	).toString("base64url")
	return `${body}.${createHmac("sha256", stateSecret()).update(body).digest("base64url")}`
}

export const readState = (
	state: string
): { instanceGuid: string; userId: number; name: string; provider: ProviderId; purpose: ConnectPurpose; site?: string } => {
	const [body, sig] = state.split(".")
	const expected = createHmac("sha256", stateSecret()).update(body ?? "").digest("base64url")
	if (!sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
		throw new Error("The sign-in link is invalid. Start again from Agility.")
	}
	const s = JSON.parse(Buffer.from(body, "base64url").toString())
	if (s.e < Date.now()) throw new Error("The sign-in link expired. Start again from Agility.")
	return { instanceGuid: s.g, userId: s.u, name: s.nm ?? "", provider: s.p, purpose: s.k === "admin" ? "admin" : "user", site: s.s }
}

export const redirectUri = () => `${appUrl()}/api/connect/callback`

// --- connections and sessions ------------------------------------------------------------------------------

/**
 * Two kinds of connect (Joel, 2026-10-12): an Agility admin authorizes a provider site for the instance first; then
 * each editor connects their own account, which must be to that same site. The admin's connection is kept for work no
 * editor is present for: webhooks, and backlink updates when a link's creator has disconnected.
 */
export const completeConnect = async (code: string, state: string): Promise<Connection> => {
	const s = readState(state)
	const a = adapter()
	if (s.provider !== a.id) throw new Error("This sign-in was started for a different provider.")
	const setup = await store().getSetup(s.instanceGuid, a.id)
	if (s.purpose === "user" && !setup) throw new Error(`${a.label} isn't authorized for this Agility instance yet. Ask an Agility admin.`)
	// Admin: the site named in the app's config. Editor: the site the admin authorized, nothing else.
	const r = await a.exchangeCode(code, redirectUri(), s.purpose === "user" ? setup!.siteId : s.site)
	const existing = await store().getConnection(s.instanceGuid, s.userId, a.id)
	const c: Connection = {
		id: existing?.id ?? randomUUID(),
		instanceGuid: s.instanceGuid,
		agilityUserId: s.userId,
		provider: a.id,
		siteId: r.site.id,
		siteName: r.site.name,
		siteUrl: r.site.url,
		account: r.account,
		connectedAt: new Date().toISOString()
	}
	await store().saveConnection(c, r.tokens)
	if (s.purpose === "admin") {
		await store().saveSetup({
			instanceGuid: s.instanceGuid,
			provider: a.id,
			siteId: r.site.id,
			siteName: r.site.name,
			siteUrl: r.site.url,
			connectionId: c.id,
			authorizedByUserId: s.userId,
			authorizedByName: s.name,
			authorizedAt: c.connectedAt
		})
		// TODO(plan §5.4, waits on hosting): register the site's webhook here with the admin's session, and renew it every
		// 30 days from a scheduled job.
	}
	return c
}

export const getSetup = (instanceGuid: string) => store().getSetup(instanceGuid, adapter().id)

/** Remove the instance's authorization. Editors' own connections stay, but stop working until it's authorized again. */
export const removeSetup = async (instanceGuid: string) => {
	const setup = await store().getSetup(instanceGuid, adapter().id)
	if (!setup) return
	await store().deleteSetup(instanceGuid, adapter().id)
}

/** A live session for a connection, refreshing (and storing the rotated refresh token) when the access token is due. */
export const sessionFor = async (c: Connection): Promise<Session> => {
	let tokens = await store().getTokens(c.id)
	if (!tokens) throw new NotConnectedError()
	if (tokens.expiresAt - Date.now() < 2 * 60_000) {
		try {
			tokens = await adapter().refresh(tokens)
		} catch {
			// A dead refresh token (revoked, or 90 days unused) means the user must reconnect. Plan §11: Reconnect + email.
			throw new NotConnectedError()
		}
		await store().saveTokens(c.id, tokens satisfies Tokens)
	}
	return { siteId: c.siteId, siteUrl: c.siteUrl, accessToken: tokens.accessToken }
}

export class NotConnectedError extends Error {
	constructor() {
		super("not_connected")
	}
}

export class NotAuthorizedError extends Error {
	constructor() {
		super("not_authorized")
	}
}

/** The caller's own connection, which must be to the site the instance's admin authorized. */
export const connectionFor = async (caller: AgilityCaller) => {
	const setup = await store().getSetup(caller.instanceGuid, adapter().id)
	if (!setup) throw new NotAuthorizedError()
	const c = await store().getConnection(caller.instanceGuid, caller.userId, adapter().id)
	if (!c || c.siteId !== setup.siteId) throw new NotConnectedError()
	return c
}

export const disconnect = async (caller: AgilityCaller) => {
	const c = await store().getConnection(caller.instanceGuid, caller.userId, adapter().id)
	if (!c) return
	const tokens = await store().getTokens(c.id)
	if (tokens) await adapter().revoke?.(tokens).catch(() => {})
	await store().deleteConnection(c.id)
}

// --- links ---------------------------------------------------------------------------------------------------

export interface ContentContext {
	ref: ContentRef
	title: string
	state: Backlink["contentState"]
}

export const listLinks = (ref: ContentRef) => store().listLinks(ref)

export const linkTask = async (caller: AgilityCaller, ctx: ContentContext, query: string): Promise<Link> => {
	const c = await connectionFor(caller)
	const s = await sessionFor(c)
	const a = adapter()
	const [task] = await a.searchTasks(s, query, 1)
	if (!task) throw new Error("No issue matches that key or link.")
	return saveLink(caller, c, s, ctx, task.externalId)
}

export const createAndLink = async (caller: AgilityCaller, ctx: ContentContext, input: CreateTaskInput): Promise<Link> => {
	const c = await connectionFor(caller)
	const s = await sessionFor(c)
	const task = await adapter().createTask(s, input)
	return saveLink(caller, c, s, ctx, task.externalId)
}

const saveLink = async (caller: AgilityCaller, c: Connection, s: Session, ctx: ContentContext, taskId: string): Promise<Link> => {
	const a = adapter()
	const existing = (await store().listLinks(ctx.ref)).find((l) => l.taskExternalId === taskId && l.provider === a.id)
	const task = await a.getTask(s, taskId)
	if (!task) throw new Error("That issue no longer exists.")
	const { ref } = await a.upsertBacklink(s, task.externalId, backlinkFor(ctx.ref, ctx.title, ctx.state))
	const now = new Date().toISOString()
	const link: Link = {
		id: existing?.id ?? randomUUID(),
		content: ctx.ref,
		connectionId: c.id,
		provider: a.id,
		taskExternalId: task.externalId,
		backlinkRef: ref,
		createdByUserId: existing?.createdByUserId ?? caller.userId,
		createdAt: existing?.createdAt ?? now,
		lastSyncedAt: now,
		snapshot: task
	}
	await store().saveLink(link)
	return link
}

export const unlink = async (caller: AgilityCaller, ref: ContentRef, linkId: string) => {
	const link = (await store().listLinks(ref)).find((l) => l.id === linkId)
	if (!link) return
	// Remove our backlink with the caller's own token; if they can't (not connected, no access), the link still goes.
	try {
		const s = await sessionFor(await connectionFor(caller))
		await adapter().removeBacklink(s, link.taskExternalId, backlinkFor(ref, "", "draft"))
	} catch {
		/* the Jira side keeps a stale link; the reconcile job (phase 2) removes it */
	}
	await store().deleteLink(link.id)
}

/** Re-read the issues behind a content's links (the panel's "refresh"). */
export const refreshLinks = async (caller: AgilityCaller, ref: ContentRef) => {
	const c = await connectionFor(caller)
	const s = await sessionFor(c)
	const links = await store().listLinks(ref)
	for (const l of links) {
		const task = await adapter().getTask(s, l.taskExternalId)
		if (task) await store().saveLink({ ...l, snapshot: task, lastSyncedAt: new Date().toISOString() })
	}
	return store().listLinks(ref)
}

// --- sync: provider → Agility --------------------------------------------------------------------------------

/** A verified provider webhook: refresh the snapshot of every link to the changed issue, with the admin's authorization. */
export const handleProviderWebhook = async (headers: Headers, rawBody: string) => {
	const a = adapter()
	const events = await a.verifyWebhook(headers, rawBody)
	for (const e of events) {
		const links = await store().listLinksForTask(a.id, e.taskExternalId)
		if (!links.length) continue
		if (e.type === "task_deleted") {
			for (const l of links) await store().saveLink({ ...l, snapshot: { ...l.snapshot, rawStatus: "Deleted in Jira" }, lastSyncedAt: new Date().toISOString() })
			continue
		}
		// The admin's connection for an instance authorized against this site: webhooks have no Agility user.
		const [setup] = await store().findSetupsBySite(a.id, e.siteId)
		const c = setup ? await store().getConnectionById(setup.connectionId) : null
		if (!c) continue
		const task = e.task ?? (await a.getTask(await sessionFor(c), e.taskExternalId))
		if (!task) continue
		for (const l of links) await store().saveLink({ ...l, snapshot: task, lastSyncedAt: new Date().toISOString() })
	}
	return events.length
}

// --- sync: Agility → provider --------------------------------------------------------------------------------

/** Content changed state (saved, approved, published): update the backlink on every issue it's linked to. */
export const pushContentState = async (ctx: ContentContext) => {
	const a = adapter()
	for (const l of await store().listLinks(ctx.ref)) {
		// The token of whoever made the link; if they've disconnected, the admin's authorization for the instance.
		const setup = await store().getSetup(ctx.ref.instanceGuid, a.id)
		const conn = (await store().getConnectionById(l.connectionId)) ?? (setup ? await store().getConnectionById(setup.connectionId) : null)
		if (!conn) continue
		await a.upsertBacklink(await sessionFor(conn), l.taskExternalId, backlinkFor(ctx.ref, ctx.title, ctx.state))
	}
}
