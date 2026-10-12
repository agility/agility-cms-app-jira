import { strict as assert } from "node:assert"
import { test } from "node:test"

import type { ContentRef, Link } from "../lib/core/types.ts"
import { createRedisStore } from "../lib/store/redis.ts"

process.env.WORK_TOKEN_KEY = Buffer.alloc(32, 9).toString("base64")

/** A tiny fake of Upstash's /pipeline endpoint: just the commands the store uses. */
const fakeUpstash = () => {
	const kv = new Map<string, string>()
	const sets = new Map<string, Set<string>>()
	const run = ([cmd, ...a]: (string | number)[]): unknown => {
		const s = (key: string) => sets.get(key) ?? sets.set(key, new Set()).get(key)!
		switch (cmd) {
			case "GET":
				return kv.get(String(a[0])) ?? null
			case "SET":
				kv.set(String(a[0]), String(a[1]))
				return "OK"
			case "MGET":
				return a.map((x) => kv.get(String(x)) ?? null)
			case "DEL":
				a.forEach((x) => (kv.delete(String(x)), sets.delete(String(x))))
				return a.length
			case "SADD":
				a.slice(1).forEach((x) => s(String(a[0])).add(String(x)))
				return 1
			case "SREM":
				a.slice(1).forEach((x) => s(String(a[0])).delete(String(x)))
				return 1
			case "SMEMBERS":
				return [...(sets.get(String(a[0])) ?? [])]
			default:
				throw new Error(`unsupported ${cmd}`)
		}
	}
	const fetchImpl = (async (_url: string, init: RequestInit) => {
		const cmds = JSON.parse(String(init.body)) as (string | number)[][]
		return new Response(JSON.stringify(cmds.map((c) => ({ result: run(c) }))), { status: 200 })
	}) as unknown as typeof fetch
	return { kv, fetchImpl }
}

const ref: ContentRef = { instanceGuid: "abc12345-u", kind: "item", id: 7, locale: "en-us" }

test("redis store: setups, connections (tokens sealed at rest), links and their indexes", async () => {
	const { kv, fetchImpl } = fakeUpstash()
	const s = createRedisStore({ url: "https://redis.example", token: "t", prefix: "jira:", fetchImpl })

	await s.saveSetup({ instanceGuid: ref.instanceGuid, provider: "jira", siteId: "site-1", siteName: "Acme", siteUrl: "https://acme.atlassian.net", connectionId: "c1", authorizedByUserId: 1, authorizedByName: "A", authorizedAt: "" })
	assert.equal((await s.findSetupsBySite("jira", "site-1"))[0].instanceGuid, ref.instanceGuid)

	const conn = { id: "c1", instanceGuid: ref.instanceGuid, agilityUserId: 1, provider: "jira" as const, siteId: "site-1", siteName: "Acme", siteUrl: "", account: { externalId: "x", name: "A" }, connectedAt: "" }
	await s.saveConnection(conn, { accessToken: "secret-access", refreshToken: "secret-refresh", expiresAt: 1 })
	assert.equal((await s.getConnection(ref.instanceGuid, 1, "jira"))?.id, "c1")
	assert.equal((await s.getTokens("c1"))?.refreshToken, "secret-refresh")
	assert.ok(![...kv.values()].some((v) => v.includes("secret-refresh")), "tokens must be sealed at rest")
	assert.ok([...kv.keys()].every((key) => key.startsWith("jira:")))

	const link: Link = { id: "l1", content: ref, connectionId: "c1", provider: "jira", taskExternalId: "1001", createdByUserId: 1, createdAt: "", lastSyncedAt: "", snapshot: { provider: "jira", externalId: "1001", title: "T", statusCategory: "todo", rawStatus: "To Do", url: "", updatedAt: "" } }
	await s.saveLink(link)
	assert.equal((await s.listLinks(ref)).length, 1)
	assert.equal((await s.listLinksForTask("jira", "1001")).length, 1)
	assert.equal((await s.listLinksForInstance(ref.instanceGuid)).length, 1)
	await s.deleteLink("l1")
	assert.equal((await s.listLinks(ref)).length, 0)
	assert.equal((await s.listLinksForTask("jira", "1001")).length, 0)

	await s.deleteConnection("c1")
	assert.equal(await s.getConnection(ref.instanceGuid, 1, "jira"), null)
	assert.equal(await s.getTokens("c1"), null)
	await s.deleteSetup(ref.instanceGuid, "jira")
	assert.equal((await s.findSetupsBySite("jira", "site-1")).length, 0)
})
