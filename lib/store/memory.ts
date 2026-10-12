import type { Tokens } from "../core/adapter.ts"
import type { Connection, InstanceSetup, Link } from "../core/types.ts"
import { open, seal } from "./crypto.ts"
import { contentKey, type WorkStore } from "./store.ts"

/**
 * In-memory WorkStore: dev host, mock provider and tests only. Tokens are still sealed, so the code path that matters
 * in production (seal on write, open on read) is the one exercised here too.
 */
export const createMemoryStore = (): WorkStore => {
	const connections = new Map<string, Connection>()
	const sealed = new Map<string, string>()
	const links = new Map<string, Link>()
	const setups = new Map<string, InstanceSetup>()
	const setupKey = (guid: string, provider: string) => `${guid}|${provider}`

	return {
		getSetup: async (guid, provider) => setups.get(setupKey(guid, provider)) ?? null,
		findSetupsBySite: async (provider, siteId) => [...setups.values()].filter((s) => s.provider === provider && s.siteId === siteId),
		saveSetup: async (s) => {
			setups.set(setupKey(s.instanceGuid, s.provider), s)
		},
		deleteSetup: async (guid, provider) => {
			setups.delete(setupKey(guid, provider))
		},

		getConnection: async (guid, userId, provider) =>
			[...connections.values()].find((c) => c.instanceGuid === guid && c.agilityUserId === userId && c.provider === provider) ?? null,
		getConnectionById: async (id) => connections.get(id) ?? null,
		findConnectionBySite: async (provider, siteId) =>
			[...connections.values()].filter((c) => c.provider === provider && c.siteId === siteId),
		saveConnection: async (c, tokens) => {
			connections.set(c.id, c)
			sealed.set(c.id, seal(JSON.stringify(tokens)))
		},
		deleteConnection: async (id) => {
			connections.delete(id)
			sealed.delete(id)
		},

		getTokens: async (id) => {
			const s = sealed.get(id)
			return s ? (JSON.parse(open(s)) as Tokens) : null
		},
		saveTokens: async (id, tokens) => {
			sealed.set(id, seal(JSON.stringify(tokens)))
		},

		listLinks: async (content) => [...links.values()].filter((l) => contentKey(l.content) === contentKey(content)),
		listLinksForTask: async (provider, taskId) =>
			[...links.values()].filter((l) => l.provider === provider && l.taskExternalId === taskId),
		listLinksForInstance: async (guid) => [...links.values()].filter((l) => l.content.instanceGuid === guid),
		saveLink: async (l) => {
			links.set(l.id, l)
		},
		deleteLink: async (id) => {
			links.delete(id)
		}
	}
}
