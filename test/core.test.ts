import { strict as assert } from "node:assert"
import { createHmac } from "node:crypto"
import { test } from "node:test"

import { backlinkFor, backlinkGlobalId, contentStateFromItemState, managerUrl, parseGlobalId } from "../lib/core/content-ref.ts"
import type { ContentRef } from "../lib/core/types.ts"
import { toAdf } from "../lib/providers/jira/adf.ts"
import { createJiraAdapter, issueKeyFrom, pickSite, statusCategoryFromJira, taskFromIssue, verifyHs256 } from "../lib/providers/jira/adapter.ts"
import { createMockAdapter } from "../lib/providers/mock/adapter.ts"
import { open, seal } from "../lib/store/crypto.ts"
import { createMemoryStore } from "../lib/store/memory.ts"

const KEY = Buffer.alloc(32, 7).toString("base64")
process.env.WORK_TOKEN_KEY = KEY

const item: ContentRef = { instanceGuid: "abc12345-u", kind: "item", id: 208, locale: "en-US", containerID: 9 }

test("backlink ids are stable and round-trip, and ignore locale case", () => {
	assert.equal(backlinkGlobalId(item), "agility:abc12345-u:item:208:en-us")
	assert.deepEqual(parseGlobalId(backlinkGlobalId(item)), { instanceGuid: "abc12345-u", kind: "item", id: 208, locale: "en-us" })
	assert.equal(parseGlobalId("https://example.com"), null)
})

test("Manager App URLs: item needs its list id, page doesn't", () => {
	assert.equal(managerUrl(item), "https://app.agilitycms.com/instance/abc12345-u/en-us/content/list-9/listitem-208")
	assert.equal(managerUrl({ ...item, containerID: undefined }), "https://app.agilitycms.com/instance/abc12345-u/en-us/content")
	assert.equal(managerUrl({ ...item, kind: "page", id: 2 }), "https://app.agilitycms.com/instance/abc12345-u/en-us/pages/page-2")
})

test("Agility item states map onto backlink states", () => {
	assert.equal(contentStateFromItemState(2), "published")
	assert.equal(contentStateFromItemState(5), "awaiting_approval")
	assert.equal(contentStateFromItemState(1), "staging")
	assert.equal(contentStateFromItemState(3), "deleted")
	assert.equal(contentStateFromItemState(undefined), "draft")
	assert.match(backlinkFor(item, "Post", "published").subtitle, /Published · en-us/)
})

test("Jira status categories map one-to-one", () => {
	assert.equal(statusCategoryFromJira("new"), "todo")
	assert.equal(statusCategoryFromJira("indeterminate"), "in_progress")
	assert.equal(statusCategoryFromJira("done"), "done")
	assert.equal(statusCategoryFromJira(undefined), "todo")
})

test("issue keys come from keys and pasted links", () => {
	assert.equal(issueKeyFrom("web-12"), "WEB-12")
	assert.equal(issueKeyFrom("https://acme.atlassian.net/browse/WEB-12"), "WEB-12")
	assert.equal(issueKeyFrom("https://acme.atlassian.net/jira/software/projects/WEB/boards/1?selectedIssue=WEB-7"), "WEB-7")
	assert.equal(issueKeyFrom("pricing page copy"), null)
})

test("descriptions become ADF with clickable links", () => {
	const doc = toAdf("Line one\nOpen https://app.agilitycms.com/x\n\nSecond paragraph")
	assert.equal(doc.content.length, 2)
	const link = doc.content[0].content.find((n: any) => n.marks)
	assert.deepEqual((link as any).marks[0].attrs.href, "https://app.agilitycms.com/x")
	assert.equal(toAdf("").content.length, 1)
})

const jwt = (payload: object, secret: string) => {
	const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
	const p = Buffer.from(JSON.stringify(payload)).toString("base64url")
	return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`
}

test("webhook JWTs: right secret passes, wrong secret, tampering and expiry fail", () => {
	const exp = Math.floor(Date.now() / 1000) + 60
	assert.equal(verifyHs256(jwt({ exp }, "s3cret"), "s3cret"), true)
	assert.equal(verifyHs256(jwt({ exp }, "other"), "s3cret"), false)
	assert.equal(verifyHs256(jwt({ exp: 1 }, "s3cret"), "s3cret"), false)
	const [h, , s] = jwt({ exp }, "s3cret").split(".")
	assert.equal(verifyHs256(`${h}.${Buffer.from('{"exp":9999999999,"x":1}').toString("base64url")}.${s}`, "s3cret"), false)
	assert.equal(verifyHs256("not-a-jwt", "s3cret"), false)
})

test("tokens are sealed: round trip, and tampering is detected", () => {
	const sealed = seal('{"accessToken":"a"}', KEY)
	assert.doesNotMatch(sealed, /accessToken/)
	assert.equal(open(sealed, KEY), '{"accessToken":"a"}')
	const parts = sealed.split(".")
	parts[3] = Buffer.from("tampered").toString("base64url")
	assert.throws(() => open(parts.join("."), KEY))
})

test("Jira remote links upsert on the content's globalId, with publish state as resolved", async () => {
	const calls: { url: string; body: any }[] = []
	const fetchImpl = (async (url: string, init: RequestInit) => {
		calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
		return new Response(JSON.stringify({ id: 42 }), { status: 201 })
	}) as unknown as typeof fetch
	const jira = createJiraAdapter({ clientId: "c", clientSecret: "s", appUrl: "https://app.example", fetchImpl })
	const s = { siteId: "cloud-1", siteUrl: "https://acme.atlassian.net", accessToken: "t" }
	const r = await jira.upsertBacklink(s, "10001", backlinkFor(item, "Ship faster", "published"))
	assert.equal(r.ref, "42")
	assert.equal(calls[0].url, "https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue/10001/remotelink")
	assert.equal(calls[0].body.globalId, "agility:abc12345-u:item:208:en-us")
	assert.equal(calls[0].body.object.status.resolved, true)
	assert.equal(calls[0].body.object.icon.url16x16, "https://app.example/icons/agility-16.png")
})

test("a Jira issue becomes a Task with a browse URL", () => {
	const t = taskFromIssue(
		{ id: "1", key: "WEB-1", fields: { summary: "Hero copy", status: { name: "In Review", statusCategory: { key: "indeterminate" } }, assignee: null, duedate: "2026-11-01" } },
		"https://acme.atlassian.net/"
	)
	assert.equal(t.url, "https://acme.atlassian.net/browse/WEB-1")
	assert.equal(t.statusCategory, "in_progress")
	assert.equal(t.rawStatus, "In Review")
	assert.equal(t.assignee, undefined)
})

test("mock provider + memory store: connect, create, link, find by task", async () => {
	const a = createMockAdapter()
	const store = createMemoryStore()
	const auth = await a.exchangeCode("code", "/cb")
	const conn = { id: "c1", instanceGuid: item.instanceGuid, agilityUserId: 1, provider: "mock" as const, siteId: auth.site.id, siteName: auth.site.name, siteUrl: auth.site.url, account: auth.account, connectedAt: "" }
	await store.saveConnection(conn, auth.tokens)
	assert.equal((await store.getTokens("c1"))?.accessToken, "mock-access")
	const s = { siteId: conn.siteId, siteUrl: conn.siteUrl, accessToken: "mock-access" }
	const task = await a.createTask(s, { containerId: "1", title: "New", description: "" })
	await store.saveLink({ id: "l1", content: item, connectionId: "c1", provider: "mock", taskExternalId: task.externalId, createdByUserId: 1, createdAt: "", lastSyncedAt: "", snapshot: task })
	assert.equal((await store.listLinks({ ...item, locale: "EN-us" })).length, 1)
	assert.equal((await store.listLinksForTask("mock", task.externalId)).length, 1)
	assert.equal((await a.transition!(s, task.externalId, "done")).rawStatus, "Done")
})

test("the Jira site is never guessed: by id, host or URL, or the only one", () => {
	const sites = [
		{ id: "aaa", url: "https://acme.atlassian.net" },
		{ id: "bbb", url: "https://acme-sandbox.atlassian.net" }
	]
	assert.equal(pickSite(sites, "acme.atlassian.net")?.id, "aaa")
	assert.equal(pickSite(sites, "https://ACME-sandbox.atlassian.net/jira/your-work")?.id, "bbb")
	assert.equal(pickSite(sites, "bbb")?.id, "bbb")
	assert.equal(pickSite(sites, "other.atlassian.net"), undefined)
	assert.equal(pickSite(sites), undefined)
	assert.equal(pickSite([sites[0]])?.id, "aaa")
})
