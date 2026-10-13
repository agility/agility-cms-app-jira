import type { TaskProviderAdapter } from "../../core/adapter.ts"
import type { Backlink, Task } from "../../core/types.ts"

/**
 * An in-memory issue tracker, for local development and demos (WORK_PROVIDER=mock). It behaves like a provider: OAuth
 * round trip, search, create, transitions, backlinks. So the whole app (panel, dialogs, sync) can be built and shown
 * without an Atlassian site. Never enable it on a production deployment.
 */

const now = () => new Date().toISOString()
const SITE = { id: "mock-site", name: "Demo tracker", url: "https://tracker.example" }

const seed: Task[] = [
	["DEMO-101", "Refresh the pricing page hero copy", "in_progress", "In Progress", "Sam Rivera", "High", "Story"],
	["DEMO-102", "Translate the spring campaign landing page to French", "todo", "To Do", "Alex Chen", "Medium", "Task"],
	["DEMO-103", "Replace outdated product screenshots", "todo", "To Do", undefined, "Low", "Task"],
	["DEMO-104", "Legal review: privacy policy update", "done", "Done", "Priya Patel", "High", "Bug"]
].map(([key, title, cat, raw, who, prio, type], i) => ({
	type: type as string,
	provider: "mock" as const,
	externalId: String(10001 + i),
	key: key as string,
	title: title as string,
	statusCategory: cat as Task["statusCategory"],
	rawStatus: raw as string,
	assignee: who ? { externalId: `u${i}`, name: who as string } : undefined,
	priority: prio as string,
	url: `${SITE.url}/browse/${key}`,
	updatedAt: now()
}))

const tasks = new Map<string, Task>(seed.map((t) => [t.externalId, t]))
const backlinks = new Map<string, Map<string, Backlink>>()
let next = 10100

const RAW: Record<Task["statusCategory"], string> = { todo: "To Do", in_progress: "In Progress", done: "Done" }

export const createMockAdapter = (): TaskProviderAdapter => ({
	id: "mock",
	label: "Demo tracker",
	capabilities: () => ({ nativeStatusCategory: true, backlinkStatus: true, webhookRenewal: false }),

	authorizeUrl: (state, redirectUri) => `/api/mock/authorize?${new URLSearchParams({ state, redirect_uri: redirectUri })}`,
	exchangeCode: async () => ({
		tokens: { accessToken: "mock-access", refreshToken: "mock-refresh", expiresAt: Date.now() + 3600_000 },
		site: SITE,
		account: { externalId: "me", name: "Demo user" }
	}),
	refresh: async (t) => ({ ...t, expiresAt: Date.now() + 3600_000 }),

	getTask: async (_s, id) => tasks.get(id) ?? [...tasks.values()].find((t) => t.key === id) ?? null,
	searchTasks: async (_s, query, limit = 10) => {
		const q = query.trim().toLowerCase()
		return [...tasks.values()]
			.filter((t) => !q || t.title.toLowerCase().includes(q) || t.key?.toLowerCase() === q || q.includes(t.key!.toLowerCase()))
			.slice(0, limit)
	},
	listContainers: async () => [{ id: "1", key: "DEMO", name: "Demo website project" }],
	getCreateSchema: async () => ({
		types: [
			{ id: "task", name: "Task" },
			{ id: "bug", name: "Bug" }
		],
		typeId: "task",
		fields: [{ id: "duedate", name: "Due date", required: false, kind: "date" }]
	}),

	createTask: async (_s, input) => {
		const id = String(next++)
		const t: Task = {
			provider: "mock",
			externalId: id,
			key: `DEMO-${id.slice(-3)}`,
			title: input.title,
			type: input.typeId === "bug" ? "Bug" : "Task",
			statusCategory: "todo",
			rawStatus: "To Do",
			dueDate: input.dueDate,
			url: `${SITE.url}/browse/DEMO-${id.slice(-3)}`,
			updatedAt: now()
		}
		tasks.set(id, t)
		return t
	},
	transition: async (_s, id, target) => {
		const t = tasks.get(id)
		if (!t) throw new Error("No such task")
		const updated = { ...t, statusCategory: target, rawStatus: RAW[target], updatedAt: now() }
		tasks.set(id, updated)
		return updated
	},

	upsertBacklink: async (_s, id, b) => {
		const m = backlinks.get(id) ?? new Map()
		m.set(b.globalId, b)
		backlinks.set(id, m)
		return { ref: b.globalId }
	},
	removeBacklink: async (_s, id, b) => {
		backlinks.get(id)?.delete(b.globalId)
	},

	verifyWebhook: async () => []
})

/** For the dev host and tests: what the mock tracker would show on an issue. */
export const mockBacklinksFor = (taskId: string) => [...(backlinks.get(taskId)?.values() ?? [])]
