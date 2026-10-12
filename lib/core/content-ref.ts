import type { Backlink, ContentRef } from "./types.ts"

const MANAGER = "https://app.agilitycms.com"

/**
 * The id every backlink is upserted on. Deliberately NOT the Manager App URL: an item's URL carries its list id and
 * locale path, and a URL that changes would make Jira add a second link instead of updating the first.
 */
export const backlinkGlobalId = (ref: ContentRef): string =>
	`agility:${ref.instanceGuid}:${ref.kind}:${ref.id}:${ref.locale.toLowerCase()}`

export const parseGlobalId = (globalId: string): ContentRef | null => {
	const m = globalId.match(/^agility:([^:]+):(item|page):(\d+):([a-z]{2}(?:-[a-z0-9]+)*)$/i)
	if (!m) return null
	return { instanceGuid: m[1], kind: m[2] as ContentRef["kind"], id: Number(m[3]), locale: m[4] }
}

/** Where the link on the issue takes someone: the item or page in the Manager App. */
export const managerUrl = (ref: ContentRef): string => {
	const base = `${MANAGER}/instance/${ref.instanceGuid}/${ref.locale.toLowerCase()}`
	if (ref.kind === "page") return `${base}/pages/page-${ref.id}`
	// Without the list id the Manager App can't open the item; fall back to the content section rather than a 404.
	return ref.containerID ? `${base}/content/list-${ref.containerID}/listitem-${ref.id}` : `${base}/content`
}

/** Agility's item states (ItemState in the Manager App) mapped onto what a backlink shows. */
export const contentStateFromItemState = (state: number | undefined): Backlink["contentState"] => {
	switch (state) {
		case 2:
			return "published"
		case 3:
			return "deleted"
		case 5:
			return "awaiting_approval"
		case 1:
		case 4:
		case 6:
		case 7:
			return "staging"
		default:
			return "draft"
	}
}

const STATE_LABEL: Record<Backlink["contentState"], string> = {
	draft: "Draft",
	staging: "Staging",
	awaiting_approval: "Awaiting Approval",
	published: "Published",
	deleted: "Deleted"
}

export const backlinkFor = (ref: ContentRef, title: string, state: Backlink["contentState"]): Backlink => ({
	globalId: backlinkGlobalId(ref),
	url: managerUrl(ref),
	title: title || `${ref.kind === "page" ? "Page" : "Content item"} ${ref.id}`,
	subtitle: `Agility CMS · ${STATE_LABEL[state]} · ${ref.locale.toLowerCase()}`,
	contentState: state
})
