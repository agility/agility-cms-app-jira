import { createHmac, timingSafeEqual } from "node:crypto"

import type { AuthorizeResult, ProviderEvent, Session, TaskProviderAdapter, Tokens } from "../../core/adapter.ts"
import type { Backlink, Container, CreateField, CreateTaskInput, StatusCategory, Task } from "../../core/types.ts"
import { toAdf } from "./adf.ts"

/**
 * Jira Cloud over OAuth 2.0 (3LO), called from our backend.
 *
 * Why 3LO and not Connect or Forge: Atlassian closed Connect to new Marketplace listings in 2025 and ends its support
 * on 2027-01-31. Forge is only needed for UI inside Jira (Smart Links, an issue panel), which is phase 3 of the plan.
 * 3LO needs no Marketplace listing; until Atlassian reviews the app, its consent screen says "unreviewed app".
 *
 * ⚠️ Rate limit: a 3LO app gets 65,000 points an hour SHARED ACROSS EVERY CUSTOMER'S SITE (enforced since
 * 2026-03-02). Read from link snapshots, not live, and apply for the per-tenant tier before launch.
 *
 * Docs: developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/, …/rest/v3/, …/webhooks/, …/rate-limiting/.
 */

const AUTH = "https://auth.atlassian.com"
const API = "https://api.atlassian.com"

/**
 * read:jira-work / write:jira-work: issues, search, create, remote links. read:jira-user: assignees.
 * manage:jira-webhook: dynamic webhooks. offline_access: a refresh token.
 */
export const JIRA_SCOPES = ["read:jira-work", "write:jira-work", "read:jira-user", "manage:jira-webhook", "offline_access"]

const ISSUE_FIELDS = ["summary", "status", "assignee", "priority", "duedate", "updated", "issuetype"]

/** Jira's status categories are `new` / `indeterminate` / `done`: one-to-one with ours. */
export const statusCategoryFromJira = (key: string | undefined): StatusCategory =>
	key === "done" ? "done" : key === "indeterminate" ? "in_progress" : "todo"

export class JiraRateLimitError extends Error {
	retryAfterSeconds: number
	constructor(retryAfterSeconds: number) {
		super(`Jira rate limit: retry after ${retryAfterSeconds}s`)
		this.retryAfterSeconds = retryAfterSeconds
	}
}

interface JiraIssue {
	id: string
	key: string
	fields: {
		summary?: string
		status?: { name?: string; statusCategory?: { key?: string } }
		assignee?: { accountId: string; displayName: string; avatarUrls?: Record<string, string> } | null
		priority?: { name?: string } | null
		duedate?: string | null
		updated?: string
		issuetype?: { name?: string }
	}
}

export const taskFromIssue = (issue: JiraIssue, siteUrl: string): Task => ({
	provider: "jira",
	externalId: issue.id,
	key: issue.key,
	title: issue.fields.summary ?? issue.key,
	type: issue.fields.issuetype?.name,
	statusCategory: statusCategoryFromJira(issue.fields.status?.statusCategory?.key),
	rawStatus: issue.fields.status?.name ?? "",
	assignee: issue.fields.assignee
		? {
				externalId: issue.fields.assignee.accountId,
				name: issue.fields.assignee.displayName,
				avatarUrl: issue.fields.assignee.avatarUrls?.["48x48"]
			}
		: undefined,
	priority: issue.fields.priority?.name ?? undefined,
	dueDate: issue.fields.duedate ?? undefined,
	url: `${siteUrl.replace(/\/$/, "")}/browse/${issue.key}`,
	updatedAt: issue.fields.updated ?? new Date().toISOString()
})

/** "WEB-12", or a pasted issue URL (…/browse/WEB-12, or …?selectedIssue=WEB-12 from a board). */
export const issueKeyFrom = (query: string): string | null => {
	const q = query.trim()
	const key = /^[A-Z][A-Z0-9_]*-\d+$/i
	if (key.test(q)) return q.toUpperCase()
	const fromUrl = q.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i) ?? q.match(/[?&]selectedIssue=([A-Z][A-Z0-9_]*-\d+)/i)
	return fromUrl ? fromUrl[1].toUpperCase() : null
}

/** JQL string literal: quotes and backslashes escaped. */
const jqlString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`

const kindOf = (schemaType: string | undefined): CreateField["kind"] => {
	switch (schemaType) {
		case "string":
			return "string"
		case "date":
			return "date"
		case "user":
			return "user"
		case "option":
		case "priority":
			return "option"
		default:
			return "unsupported"
	}
}

/** Remote-link status icons: 16×16, served by this app (APP_URL). Jira shows them next to the link. */
const ICON_PATH: Record<Backlink["contentState"], string> = {
	draft: "/icons/state-draft.png",
	staging: "/icons/state-staging.png",
	awaiting_approval: "/icons/state-awaiting.png",
	published: "/icons/state-published.png",
	deleted: "/icons/state-deleted.png"
}

export interface JiraAdapterConfig {
	clientId: string
	clientSecret: string
	/** This app's public origin, for remote-link icons. */
	appUrl: string
	fetchImpl?: typeof fetch
}

export const createJiraAdapter = (cfg: JiraAdapterConfig): TaskProviderAdapter => {
	const f = cfg.fetchImpl ?? fetch

	const jira = async <T>(s: Session, path: string, init: RequestInit = {}): Promise<T> => {
		const res = await f(`${API}/ex/jira/${s.siteId}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${s.accessToken}`,
				Accept: "application/json",
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...init.headers
			}
		})
		if (res.status === 429) throw new JiraRateLimitError(Number(res.headers.get("Retry-After") ?? 60))
		if (res.status === 204) return undefined as T
		const text = await res.text()
		if (!res.ok) throw new Error(`Jira ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`)
		return (text ? JSON.parse(text) : undefined) as T
	}

	const token = async (body: Record<string, string>): Promise<Tokens & { raw: any }> => {
		const res = await f(`${AUTH}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body })
		})
		const raw = await res.json()
		if (!res.ok) throw new Error(`Atlassian token endpoint → ${res.status}: ${raw.error ?? ""} ${raw.error_description ?? ""}`)
		return {
			accessToken: raw.access_token,
			refreshToken: raw.refresh_token,
			expiresAt: Date.now() + (raw.expires_in ?? 3600) * 1000,
			scope: raw.scope,
			raw
		}
	}

	const getIssue = (s: Session, idOrKey: string) =>
		jira<JiraIssue>(s, `/rest/api/3/issue/${encodeURIComponent(idOrKey)}?fields=${ISSUE_FIELDS.join(",")}`)

	return {
		id: "jira",
		label: "Jira",

		capabilities: () => ({ nativeStatusCategory: true, backlinkStatus: true, webhookRenewal: true }),

		authorizeUrl: (state, redirectUri) => {
			const q = new URLSearchParams({
				audience: "api.atlassian.com",
				client_id: cfg.clientId,
				scope: JIRA_SCOPES.join(" "),
				redirect_uri: redirectUri,
				state,
				response_type: "code",
				prompt: "consent"
			})
			return `${AUTH}/authorize?${q}`
		},

		exchangeCode: async (code, redirectUri, wanted): Promise<AuthorizeResult> => {
			const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri })
			const sites = (await (
				await f(`${API}/oauth/token/accessible-resources`, {
					headers: { Authorization: `Bearer ${t.accessToken}`, Accept: "application/json" }
				})
			).json()) as { id: string; name: string; url: string; scopes: string[] }[]
			const site = pickSite(sites, wanted)
			if (!site) {
				const names = sites.map((x) => hostOf(x.url)).join(", ") || "none"
				throw new Error(
					wanted
						? `This Atlassian account can't reach ${wanted}. It can reach: ${names}. Sign in with the account you use for that site.`
						: `Name the Jira site in the app's settings first (Settings › Apps). This account can reach: ${names}.`
				)
			}
			const me = await jira<{ accountId: string; displayName: string; avatarUrls?: Record<string, string> }>(
				{ siteId: site.id, siteUrl: site.url, accessToken: t.accessToken },
				"/rest/api/3/myself"
			)
			const { raw: _raw, ...tokens } = t
			return {
				tokens,
				site: { id: site.id, name: site.name, url: site.url },
				account: { externalId: me.accountId, name: me.displayName, avatarUrl: me.avatarUrls?.["48x48"] }
			}
		},

		// Refresh tokens ROTATE: the response carries a new one and the old one stops working (after a short reuse
		// window). The caller must store what comes back before using it.
		refresh: async (tokens) => {
			if (!tokens.refreshToken) throw new Error("No refresh token: the user has to reconnect Jira.")
			const { raw: _raw, ...next } = await token({ grant_type: "refresh_token", refresh_token: tokens.refreshToken })
			return next
		},

		getTask: async (s, externalId) => {
			try {
				return taskFromIssue(await getIssue(s, externalId), s.siteUrl)
			} catch (e) {
				if (String(e).includes("→ 404")) return null
				throw e
			}
		},

		searchTasks: async (s, query, limit = 10) => {
			const key = issueKeyFrom(query)
			if (key) {
				const one = await getIssue(s, key).catch(() => null)
				return one ? [taskFromIssue(one, s.siteUrl)] : []
			}
			// /rest/api/3/search was removed; /search/jql pages with nextPageToken and returns no total.
			const jql = query.trim() ? `text ~ ${jqlString(query.trim())} ORDER BY updated DESC` : "ORDER BY updated DESC"
			const r = await jira<{ issues: JiraIssue[] }>(s, "/rest/api/3/search/jql", {
				method: "POST",
				body: JSON.stringify({ jql, fields: ISSUE_FIELDS, maxResults: limit })
			})
			return r.issues.map((i) => taskFromIssue(i, s.siteUrl))
		},

		listContainers: async (s): Promise<Container[]> => {
			const r = await jira<{ values: { id: string; key: string; name: string }[] }>(
				s,
				"/rest/api/3/project/search?maxResults=100&orderBy=name"
			)
			return r.values.map((p) => ({ id: p.id, key: p.key, name: p.name }))
		},

		getCreateSchema: async (s, containerId, typeId) => {
			const types = await jira<{ issueTypes: { id: string; name: string; subtask: boolean }[] }>(
				s,
				`/rest/api/3/issue/createmeta/${encodeURIComponent(containerId)}/issuetypes`
			)
			const usable = types.issueTypes.filter((t) => !t.subtask)
			const chosen = typeId ?? usable[0]?.id
			if (!chosen) return { types: [], typeId: "", fields: [] }
			const meta = await jira<{
				fields: { fieldId: string; name: string; required: boolean; schema?: { type?: string }; allowedValues?: { id: string; name?: string; value?: string }[] }[]
			}>(s, `/rest/api/3/issue/createmeta/${encodeURIComponent(containerId)}/issuetypes/${chosen}`)
			// project, issuetype, summary and description are filled by the app; everything else is the form's job.
			const handled = new Set(["project", "issuetype", "summary", "description", "reporter"])
			return {
				types: usable.map((t) => ({ id: t.id, name: t.name })),
				typeId: chosen,
				fields: meta.fields
					.filter((x) => !handled.has(x.fieldId))
					.map((x) => ({
						id: x.fieldId,
						name: x.name,
						required: x.required,
						kind: kindOf(x.schema?.type),
						options: x.allowedValues?.map((v) => ({ id: v.id, name: v.name ?? v.value ?? v.id }))
					}))
			}
		},

		createTask: async (s, input: CreateTaskInput) => {
			const created = await jira<{ id: string; key: string }>(s, "/rest/api/3/issue", {
				method: "POST",
				body: JSON.stringify({
					fields: {
						project: { id: input.containerId },
						...(input.typeId ? { issuetype: { id: input.typeId } } : {}),
						summary: input.title.slice(0, 255),
						description: toAdf(input.description),
						...(input.dueDate ? { duedate: input.dueDate } : {}),
						...input.extraFields
					}
				})
			})
			return taskFromIssue(await getIssue(s, created.id), s.siteUrl)
		},

		transition: async (s, externalId, target) => {
			const r = await jira<{ transitions: { id: string; to: { statusCategory?: { key?: string } } }[] }>(
				s,
				`/rest/api/3/issue/${externalId}/transitions`
			)
			const t = r.transitions.find((x) => statusCategoryFromJira(x.to.statusCategory?.key) === target)
			if (!t) throw new Error(`No transition to ${target} is available on this issue from its current status.`)
			await jira(s, `/rest/api/3/issue/${externalId}/transitions`, { method: "POST", body: JSON.stringify({ transition: { id: t.id } }) })
			return taskFromIssue(await getIssue(s, externalId), s.siteUrl)
		},

		// Remote issue links upsert on globalId: posting the same globalId again updates the link (Jira REST v3,
		// "Create or update remote issue link"). Limit: 2,000 per issue.
		upsertBacklink: async (s, taskExternalId, b) => {
			const icon = (path: string, title: string) => ({ url16x16: `${cfg.appUrl.replace(/\/$/, "")}${path}`, title })
			const r = await jira<{ id: number }>(s, `/rest/api/3/issue/${taskExternalId}/remotelink`, {
				method: "POST",
				body: JSON.stringify({
					globalId: b.globalId,
					application: { type: "com.agilitycms", name: "Agility CMS" },
					relationship: "Content in Agility CMS",
					object: {
						url: b.url,
						title: b.title,
						summary: b.subtitle,
						icon: icon("/icons/agility-16.png", "Agility CMS"),
						// `resolved` strikes the link through in Jira: used for published content, so an issue's list of
						// links reads as a checklist of what's live.
						status: { resolved: b.contentState === "published", icon: icon(ICON_PATH[b.contentState], b.subtitle) }
					}
				})
			})
			return { ref: String(r.id) }
		},

		removeBacklink: async (s, taskExternalId, b) => {
			await jira(s, `/rest/api/3/issue/${taskExternalId}/remotelink?globalId=${encodeURIComponent(b.globalId)}`, {
				method: "DELETE"
			})
		},

		// Dynamic webhooks for OAuth apps: at most 5 per app per user per site, each expiring after 30 days unless
		// refreshed. JQL filters support only a few clauses (project, issuetype, status, assignee, issueKey…).
		subscribe: async (s, url, containerKeys) => {
			const r = await jira<{ webhookRegistrationResult: { createdWebhookId?: number; errors?: string[] }[] }>(
				s,
				"/rest/api/3/webhook",
				{
					method: "POST",
					body: JSON.stringify({
						url,
						webhooks: [
							{
								events: ["jira:issue_updated", "jira:issue_deleted"],
								jqlFilter: containerKeys.length ? `project IN (${containerKeys.map(jqlString).join(", ")})` : "project IS NOT EMPTY"
							}
						]
					})
				}
			)
			const ids = r.webhookRegistrationResult.flatMap((x) => (x.createdWebhookId ? [String(x.createdWebhookId)] : []))
			const errors = r.webhookRegistrationResult.flatMap((x) => x.errors ?? [])
			if (!ids.length) throw new Error(`Jira refused the webhook: ${errors.join("; ")}`)
			return { ids }
		},

		renewSubscriptions: async (s, ids) => {
			const r = await jira<{ expirationDate?: string }>(s, "/rest/api/3/webhook/refresh", {
				method: "PUT",
				body: JSON.stringify({ webhookIds: ids.map(Number) })
			})
			return { expiresAt: r?.expirationDate }
		},

		// Deliveries to an OAuth app's webhooks carry `Authorization: Bearer <JWT>`, HS256-signed with the app's client
		// secret. Verify it before trusting anything in the body.
		verifyWebhook: async (headers, rawBody) => {
			const auth = headers.get("authorization") ?? ""
			const jwt = auth.replace(/^Bearer\s+/i, "")
			if (!verifyHs256(jwt, cfg.clientSecret)) throw new Error("Jira webhook: bad or missing signature")
			const body = JSON.parse(rawBody) as { webhookEvent?: string; issue?: JiraIssue & { self?: string } }
			if (!body.issue) return []
			// The site isn't a top-level field; the issue's self URL carries it (api.atlassian.com/ex/jira/{cloudid}/…).
			const siteId = body.issue.self?.match(/\/ex\/jira\/([^/]+)\//)?.[1] ?? ""
			const event: ProviderEvent = {
				type: body.webhookEvent === "jira:issue_deleted" ? "task_deleted" : "task_updated",
				siteId,
				taskExternalId: body.issue.id
			}
			return [event]
		}
	}
}

const hostOf = (url: string) => {
	try {
		return new URL(url).host.toLowerCase()
	} catch {
		return url.toLowerCase()
	}
}

/** The site to use: the one asked for (cloud id, host or URL), or the only one the account has. Never a guess. */
export const pickSite = <S extends { id: string; url: string }>(sites: S[], wanted?: string): S | undefined => {
	if (!wanted) return sites.length === 1 ? sites[0] : undefined
	const w = wanted.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
	return sites.find((x) => x.id.toLowerCase() === w || hostOf(x.url) === w)
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")

/** HS256 JWT check: signature and expiry. Exported for tests. */
export const verifyHs256 = (jwt: string, secret: string, now = Date.now()): boolean => {
	const parts = jwt.split(".")
	if (parts.length !== 3) return false
	const [h, p, sig] = parts
	try {
		const header = JSON.parse(Buffer.from(h, "base64url").toString())
		if (header.alg !== "HS256") return false
		const expected = b64url(createHmac("sha256", secret).update(`${h}.${p}`).digest())
		const a = Buffer.from(sig)
		const b = Buffer.from(expected)
		if (a.length !== b.length || !timingSafeEqual(a, b)) return false
		const payload = JSON.parse(Buffer.from(p, "base64url").toString())
		return typeof payload.exp !== "number" || payload.exp * 1000 > now
	} catch {
		return false
	}
}
