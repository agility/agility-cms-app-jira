import type { Tokens } from "../core/adapter.ts"
import type { Connection, InstanceSetup, Link } from "../core/types.ts"
import { open, seal } from "./crypto.ts"
import { contentKey, type WorkStore } from "./store.ts"

/**
 * WorkStore on Redis, through Upstash's REST API (provisioned from the Vercel Marketplace, which sets KV_REST_API_URL
 * and KV_REST_API_TOKEN on the project). No client library: each call is one HTTPS request, which suits serverless.
 *
 * Keys (all JSON values; tokens sealed with AES-256-GCM before they get here):
 *   setup:{guid}|{provider}            InstanceSetup         setup-site:{provider}|{siteId}   set of guids
 *   conn:{id}                          Connection            conn-user:{guid}|{user}|{prov}   connection id
 *   conn-site:{provider}|{siteId}      set of connection ids tok:{id}                         sealed Tokens
 *   link:{id}                          Link                  links-content:{contentKey}       set of link ids
 *   links-task:{provider}|{taskId}     set of link ids       links-instance:{guid}            set of link ids
 */

type Cmd = (string | number)[]

export interface RedisConfig {
	url: string
	token: string
	/** Prefix for every key, so one database can serve several deployments (e.g. "jira:prod:"). */
	prefix?: string
	fetchImpl?: typeof fetch
}

export const createRedisStore = (cfg: RedisConfig): WorkStore => {
	const f = cfg.fetchImpl ?? fetch
	const p = cfg.prefix ?? ""
	const k = (key: string) => `${p}${key}`

	const pipeline = async (cmds: Cmd[]): Promise<unknown[]> => {
		const res = await f(`${cfg.url.replace(/\/$/, "")}/pipeline`, {
			method: "POST",
			headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
			body: JSON.stringify(cmds)
		})
		if (!res.ok) throw new Error(`Redis → ${res.status}`)
		const out = (await res.json()) as { result?: unknown; error?: string }[]
		const err = out.find((r) => r.error)
		if (err) throw new Error(`Redis: ${err.error}`)
		return out.map((r) => r.result)
	}
	const one = async (cmd: Cmd) => (await pipeline([cmd]))[0]

	const getJson = async <T>(key: string): Promise<T | null> => {
		const v = (await one(["GET", k(key)])) as string | null
		return v ? (JSON.parse(v) as T) : null
	}
	const getMany = async <T>(prefix: string, ids: string[]): Promise<T[]> => {
		if (!ids.length) return []
		const vals = (await one(["MGET", ...ids.map((id) => k(`${prefix}${id}`))])) as (string | null)[]
		return vals.filter((v): v is string => Boolean(v)).map((v) => JSON.parse(v) as T)
	}
	const members = async (key: string) => ((await one(["SMEMBERS", k(key)])) as string[]) ?? []

	const linkIndexes = (l: Link) => [
		`links-content:${contentKey(l.content)}`,
		`links-task:${l.provider}|${l.taskExternalId}`,
		`links-instance:${l.content.instanceGuid}`
	]

	return {
		getSetup: (guid, provider) => getJson<InstanceSetup>(`setup:${guid}|${provider}`),
		findSetupsBySite: async (provider, siteId) => {
			const guids = await members(`setup-site:${provider}|${siteId}`)
			return getMany<InstanceSetup>("setup:", guids.map((g) => `${g}|${provider}`))
		},
		saveSetup: async (s) => {
			const old = await getJson<InstanceSetup>(`setup:${s.instanceGuid}|${s.provider}`)
			await pipeline([
				...(old && old.siteId !== s.siteId ? [["SREM", k(`setup-site:${s.provider}|${old.siteId}`), s.instanceGuid]] : []),
				["SET", k(`setup:${s.instanceGuid}|${s.provider}`), JSON.stringify(s)],
				["SADD", k(`setup-site:${s.provider}|${s.siteId}`), s.instanceGuid]
			])
		},
		deleteSetup: async (guid, provider) => {
			const old = await getJson<InstanceSetup>(`setup:${guid}|${provider}`)
			if (!old) return
			await pipeline([
				["DEL", k(`setup:${guid}|${provider}`)],
				["SREM", k(`setup-site:${provider}|${old.siteId}`), guid]
			])
		},

		getConnection: async (guid, userId, provider) => {
			const id = (await one(["GET", k(`conn-user:${guid}|${userId}|${provider}`)])) as string | null
			return id ? getJson<Connection>(`conn:${id}`) : null
		},
		getConnectionById: (id) => getJson<Connection>(`conn:${id}`),
		findConnectionBySite: async (provider, siteId) => getMany<Connection>("conn:", await members(`conn-site:${provider}|${siteId}`)),
		saveConnection: async (c, tokens) => {
			await pipeline([
				["SET", k(`conn:${c.id}`), JSON.stringify(c)],
				["SET", k(`conn-user:${c.instanceGuid}|${c.agilityUserId}|${c.provider}`), c.id],
				["SADD", k(`conn-site:${c.provider}|${c.siteId}`), c.id],
				["SET", k(`tok:${c.id}`), seal(JSON.stringify(tokens))]
			])
		},
		deleteConnection: async (id) => {
			const c = await getJson<Connection>(`conn:${id}`)
			if (!c) return
			await pipeline([
				["DEL", k(`conn:${id}`), k(`tok:${id}`), k(`conn-user:${c.instanceGuid}|${c.agilityUserId}|${c.provider}`)],
				["SREM", k(`conn-site:${c.provider}|${c.siteId}`), id]
			])
		},

		getTokens: async (id) => {
			const s = (await one(["GET", k(`tok:${id}`)])) as string | null
			return s ? (JSON.parse(open(s)) as Tokens) : null
		},
		saveTokens: async (id, tokens) => {
			await one(["SET", k(`tok:${id}`), seal(JSON.stringify(tokens))])
		},

		listLinks: async (content) => getMany<Link>("link:", await members(`links-content:${contentKey(content)}`)),
		listLinksForTask: async (provider, taskId) => getMany<Link>("link:", await members(`links-task:${provider}|${taskId}`)),
		listLinksForInstance: async (guid) => getMany<Link>("link:", await members(`links-instance:${guid}`)),
		saveLink: async (l) => {
			await pipeline([["SET", k(`link:${l.id}`), JSON.stringify(l)], ...linkIndexes(l).map((ix) => ["SADD", k(ix), l.id])])
		},
		deleteLink: async (id) => {
			const l = await getJson<Link>(`link:${id}`)
			if (!l) return
			await pipeline([["DEL", k(`link:${id}`)], ...linkIndexes(l).map((ix) => ["SREM", k(ix), id])])
		}
	}
}

/** The Redis store when the project has Upstash credentials (Vercel Marketplace names first), else null. */
export const redisFromEnv = (env = process.env): WorkStore | null => {
	const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL
	const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN
	if (!url || !token) return null
	return createRedisStore({ url, token, prefix: env.WORK_STORE_PREFIX ?? `${env.WORK_PROVIDER ?? "jira"}:` })
}
