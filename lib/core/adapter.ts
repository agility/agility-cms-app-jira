import type { Backlink, Container, CreateField, CreateTaskInput, Person, ProviderId, StatusCategory, Task } from "./types.ts"

/**
 * Tokens for one connection, as the adapter needs them. Refreshing returns a new set; the caller stores it.
 * Jira rotates refresh tokens (each use issues a new one and disables the old one), so a refresh that isn't stored is a
 * disconnection waiting to happen.
 */
export interface Tokens {
	accessToken: string
	refreshToken?: string
	/** Epoch ms. */
	expiresAt: number
	scope?: string
}

/** One authenticated call context: the connection's site and a live access token. */
export interface Session {
	siteId: string
	/** The site's own URL (https://acme.atlassian.net), for links people open. */
	siteUrl: string
	accessToken: string
}

export interface AuthorizeResult {
	tokens: Tokens
	site: { id: string; name: string; url: string }
	account: Person
}

/** A verified change from the provider, already reduced to the task it's about. */
export interface ProviderEvent {
	type: "task_updated" | "task_deleted"
	siteId: string
	taskExternalId: string
	task?: Task
}

/**
 * The contract every provider implements. Kept small on purpose: anything only one tool can do goes behind
 * capabilities() rather than into the interface, so the Work panel never has to special-case a provider by name.
 *
 * Plan: system-overview plans/task-management-apps.md §5.3.
 */
export interface TaskProviderAdapter {
	readonly id: ProviderId
	readonly label: string

	capabilities(): {
		/** The tool has status categories of its own (Jira, Linear); otherwise a StatusMap is needed (Monday, Asana). */
		nativeStatusCategory: boolean
		/** The tool can show our backlink with a status (Jira remote links, Linear attachments). */
		backlinkStatus: boolean
		/** Webhook subscriptions expire and must be renewed (Jira: every 30 days). */
		webhookRenewal: boolean
	}

	// --- auth -------------------------------------------------------------------------------------------
	authorizeUrl(state: string, redirectUri: string): string
	/**
	 * `site`: which of the account's sites to use, by id or by host (acme.atlassian.net). Admins name it in the app's
	 * config; editors are held to the one the admin authorized. Without it, the adapter may only pick when there is
	 * exactly one.
	 */
	exchangeCode(code: string, redirectUri: string, site?: string): Promise<AuthorizeResult>
	refresh(tokens: Tokens): Promise<Tokens>
	revoke?(tokens: Tokens): Promise<void>

	// --- read -------------------------------------------------------------------------------------------
	getTask(s: Session, externalId: string): Promise<Task | null>
	/** Free text, a key ("WEB-12") or a pasted URL. */
	searchTasks(s: Session, query: string, limit?: number): Promise<Task[]>
	listContainers(s: Session): Promise<Container[]>
	/** The task types a container offers, and the fields one of them needs (the first type when typeId is omitted). */
	getCreateSchema(
		s: Session,
		containerId: string,
		typeId?: string
	): Promise<{ types: { id: string; name: string }[]; typeId: string; fields: CreateField[] }>

	// --- write ------------------------------------------------------------------------------------------
	createTask(s: Session, input: CreateTaskInput): Promise<Task>
	transition?(s: Session, externalId: string, target: StatusCategory): Promise<Task>
	assign?(s: Session, externalId: string, user: Person | null): Promise<Task>

	// --- the other half of the link ---------------------------------------------------------------------
	/** Idempotent on backlink.globalId: calling it again updates the existing backlink instead of adding one. */
	upsertBacklink(s: Session, taskExternalId: string, backlink: Backlink): Promise<{ ref: string }>
	removeBacklink(s: Session, taskExternalId: string, backlink: Pick<Backlink, "globalId">): Promise<void>

	// --- events -----------------------------------------------------------------------------------------
	/** Ask the provider to send changes for these containers to `url`. Returns ids to renew or delete later. */
	subscribe?(s: Session, url: string, containerKeys: string[]): Promise<{ ids: string[]; expiresAt?: string }>
	renewSubscriptions?(s: Session, ids: string[]): Promise<{ expiresAt?: string }>
	/** Verify a webhook delivery and reduce it to events. Throws on a bad signature. */
	verifyWebhook(headers: Headers, rawBody: string): Promise<ProviderEvent[]>
}
