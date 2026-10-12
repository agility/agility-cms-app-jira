import "server-only"

import { contentStateFromItemState } from "../core/content-ref.ts"
import type { ContentRef } from "../core/types.ts"
import { AuthError, isDevCaller, mgmtBaseUrl, type AgilityCaller } from "./identity.ts"
import type { ContentContext } from "../work.ts"

/**
 * Turn what the panel sends into a trusted ContentContext. The browser says which item or page it's on; the
 * Management API, called with the editor's own token, says what state it's in, what it's called and which list it
 * lives in. The app sidebar surface doesn't send workflow state at all (plan §3), and the list id is needed for the
 * item's Manager App URL.
 */
export const resolveContent = async (raw: any, caller: AgilityCaller, f: typeof fetch = fetch): Promise<ContentContext> => {
	const r = raw?.ref ?? {}
	const ref: ContentRef = {
		instanceGuid: String(r.instanceGuid ?? ""),
		kind: r.kind === "page" ? "page" : "item",
		id: Number(r.id),
		locale: String(r.locale ?? "").toLowerCase()
	}
	if (ref.instanceGuid !== caller.instanceGuid) throw new AuthError("That content is on a different instance.")
	if (!Number.isInteger(ref.id) || ref.id <= 0 || !/^[a-z]{2}(-[a-z0-9]+)*$/.test(ref.locale)) throw new Error("Bad content reference.")

	if (isDevCaller(caller.token)) return { ref, title: String(raw?.title || `Content ${ref.id}`), state: "staging" }

	const base = `${mgmtBaseUrl(ref.instanceGuid)}/api/v1/instance/${ref.instanceGuid}`
	const get = async (path: string) => {
		const res = await f(`${base}${path}`, { headers: { Authorization: `Bearer ${caller.token}`, Accept: "application/json" } })
		if (!res.ok) throw new Error(`Agility ${path} → ${res.status}`)
		return res.json()
	}

	if (ref.kind === "page") {
		const page = await get(`/${ref.locale}/page/${ref.id}`)
		return { ref, title: page.title ?? page.name ?? `Page ${ref.id}`, state: contentStateFromItemState(page.properties?.state) }
	}

	const item = await get(`/${ref.locale}/item/${ref.id}`)
	const referenceName: string | undefined = item.properties?.referenceName
	if (referenceName) {
		const container = await get(`/container/${encodeURIComponent(referenceName)}`).catch(() => null)
		if (container?.contentViewID) ref.containerID = container.contentViewID
	}
	const titleFromFields = ["title", "heading", "name", "headline"].map((k) => item.fields?.[k]).find((v) => typeof v === "string" && v.trim())
	return {
		ref,
		title: String(raw?.title || titleFromFields || referenceName || `Content item ${ref.id}`).slice(0, 255),
		state: contentStateFromItemState(item.properties?.state)
	}
}
