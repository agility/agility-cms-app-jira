import type { Tokens } from "../core/adapter.ts"
import type { Connection, ContentRef, InstanceSetup, Link } from "../core/types.ts"

/**
 * Where Agility Work keeps connections, sealed tokens and links.
 *
 * ⏸️ The production backing store is an open decision (plan §5.1, §12): Azure Table/SQL behind Key Vault, or a managed
 * service. Until then only the in-memory store exists, which is enough for the dev host and the mock provider and
 * loses everything on restart. Every caller goes through this interface, so swapping the store touches one file.
 */
export interface WorkStore {
	getSetup(instanceGuid: string, provider: InstanceSetup["provider"]): Promise<InstanceSetup | null>
	/** Every instance authorized against a site: webhooks arrive per site, not per instance. */
	findSetupsBySite(provider: InstanceSetup["provider"], siteId: string): Promise<InstanceSetup[]>
	saveSetup(s: InstanceSetup): Promise<void>
	deleteSetup(instanceGuid: string, provider: InstanceSetup["provider"]): Promise<void>

	getConnection(instanceGuid: string, agilityUserId: number, provider: Connection["provider"]): Promise<Connection | null>
	getConnectionById(id: string): Promise<Connection | null>
	/** Any user's connection to this provider on this instance: used by webhook processing, which has no user. */
	findConnectionBySite(provider: Connection["provider"], siteId: string): Promise<Connection[]>
	saveConnection(c: Connection, tokens: Tokens): Promise<void>
	deleteConnection(id: string): Promise<void>

	getTokens(connectionId: string): Promise<Tokens | null>
	/** Must be called with what a refresh returns before the new access token is used: Jira rotates refresh tokens. */
	saveTokens(connectionId: string, tokens: Tokens): Promise<void>

	listLinks(content: ContentRef): Promise<Link[]>
	listLinksForTask(provider: Link["provider"], taskExternalId: string): Promise<Link[]>
	/** For the content dashboard (phase 2): every link on an instance. */
	listLinksForInstance(instanceGuid: string): Promise<Link[]>
	saveLink(link: Link): Promise<void>
	deleteLink(id: string): Promise<void>
}

export const contentKey = (r: ContentRef) => `${r.instanceGuid}|${r.kind}|${r.id}|${r.locale.toLowerCase()}`
