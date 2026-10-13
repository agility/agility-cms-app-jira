/**
 * Agility Work: the provider-agnostic model behind every task-management app (Jira first, then Linear, Asana,
 * Monday). Nothing in here knows which tool it is talking to; that lives in lib/providers/<name>.
 *
 * Plan: system-overview plans/task-management-apps.md §5.2.
 */

export type ProviderId = "jira" | "mock"

/** Every tool's statuses collapse to these three, so the panel can sort and colour without knowing the tool. */
export type StatusCategory = "todo" | "in_progress" | "done"

/** A piece of Agility content a task can be linked to. Links are per locale: the French page can have its own issue. */
export interface ContentRef {
	instanceGuid: string
	kind: "item" | "page"
	/** contentID for an item, pageID for a page. */
	id: number
	locale: string
	/** Needed to build an item's Manager App URL (`list-{containerID}`); unused for pages. */
	containerID?: number
}

export interface Person {
	externalId: string
	name: string
	avatarUrl?: string
}

/** The provider's issue, reduced to what the panel shows. `rawStatus` keeps the tool's own wording for display. */
export interface Task {
	provider: ProviderId
	externalId: string
	/** The human key, e.g. "WEB-123". Linear and Jira have one; Asana and Monday don't. */
	key?: string
	title: string
	/** The tool's own type name ("Task", "Bug", "Story"), for its icon. */
	type?: string
	statusCategory: StatusCategory
	rawStatus: string
	assignee?: Person
	priority?: string
	dueDate?: string
	url: string
	updatedAt: string
}

/** One provider account connected by one Agility user on one instance. Tokens live in the token store, never here. */
export interface Connection {
	id: string
	instanceGuid: string
	agilityUserId: number
	provider: ProviderId
	/** Jira cloud id, Linear organisation, Asana workspace: whatever scopes the provider's API calls. */
	siteId: string
	siteName: string
	siteUrl: string
	account: Person
	connectedAt: string
}

/**
 * An Agility admin's authorization of one provider site for a whole instance (Joel, 2026-10-12: "an admin would need
 * to authorize the jira app and each user would need to authenticate inside agility"). Editors' own connections must
 * be to this site; the admin's connection is the one background work (webhooks, backlink updates) runs on.
 */
export interface InstanceSetup {
	instanceGuid: string
	provider: ProviderId
	siteId: string
	siteName: string
	siteUrl: string
	/** The admin's own connection, used for work no editor is present for. */
	connectionId: string
	authorizedByUserId: number
	authorizedByName: string
	authorizedAt: string
	webhookIds?: string[]
	webhookExpiresAt?: string
}

/** Content ↔ task. The snapshot is what the panel shows, refreshed by webhooks, so opening a panel costs no API calls. */
export interface Link {
	id: string
	content: ContentRef
	connectionId: string
	provider: ProviderId
	taskExternalId: string
	/** The provider's handle on the backlink we wrote on its side (Jira remote link id, Linear attachment id). */
	backlinkRef?: string
	createdByUserId: number
	createdAt: string
	lastSyncedAt: string
	snapshot: Task
}

/** A project, team or board a task can be created in. */
export interface Container {
	id: string
	key?: string
	name: string
}

/** The fields a container needs on create, discovered at run time (Jira projects differ). */
export interface CreateField {
	id: string
	name: string
	required: boolean
	kind: "string" | "text" | "option" | "date" | "user" | "unsupported"
	options?: { id: string; name: string }[]
}

export interface CreateTaskInput {
	containerId: string
	typeId?: string
	title: string
	/** Plain text; adapters convert it (Jira needs ADF). */
	description: string
	dueDate?: string
	extraFields?: Record<string, unknown>
}

/** What we write on the provider's side so the issue shows the content it's about, and that content's state. */
export interface Backlink {
	/** Stable id for upserts: see backlinkGlobalId(). */
	globalId: string
	url: string
	title: string
	/** e.g. "Agility CMS · Published · en-us". */
	subtitle: string
	/** Our content's state, mapped by the adapter onto whatever the provider can show. */
	contentState: "draft" | "staging" | "awaiting_approval" | "published" | "deleted"
}
