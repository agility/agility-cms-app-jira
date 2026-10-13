"use client"

import { getManagementAPIToken, pageMethods, useAgilityAppSDK } from "@agility/app-sdk"
import { useCallback, useEffect, useState } from "react"

/**
 * The panel's side of the app: which content it's on, and a fetch that carries the editor's Agility token to our
 * backend. The token comes from the host on demand (getManagementAPIToken) and is never stored in the iframe.
 */

export interface ContentRefLite {
	instanceGuid: string
	kind: "item" | "page"
	id: number
	locale: string
}

export class ApiError extends Error {
	status: number
	body: any
	constructor(status: number, body: any) {
		super(body?.message ?? body?.error ?? `HTTP ${status}`)
		this.status = status
		this.body = body
	}
}

export const useApi = (instanceGuid: string | undefined) =>
	useCallback(
		async <T = any>(path: string, init: RequestInit = {}): Promise<T> => {
			if (!instanceGuid) throw new ApiError(0, { error: "no_instance" })
			const token = (await getManagementAPIToken()) as string | undefined
			const res = await fetch(path, {
				...init,
				headers: {
					Authorization: `Bearer ${token ?? ""}`,
					"x-agility-instance": instanceGuid,
					...(init.body ? { "Content-Type": "application/json" } : {}),
					...init.headers
				}
			})
			const body = await res.json().catch(() => ({}))
			if (!res.ok) throw new ApiError(res.status, body)
			return body as T
		},
		[instanceGuid]
	)

const TITLE_KEYS = ["title", "heading", "name", "headline"]

/** Where the panel is: the content item or page in the host's context. */
export const useContentRef = (kind: "item" | "page") => {
	const { initializing, instance, locale, contentItem } = useAgilityAppSDK()
	const [ref, setRef] = useState<ContentRefLite | null>(null)
	const [title, setTitle] = useState("")
	const [unsaved, setUnsaved] = useState(false)

	useEffect(() => {
		if (initializing || !instance?.guid || !locale) return
		if (kind === "item") {
			if (!contentItem) return
			// A new item has no id until its first save, and there's nothing to link yet.
			if (!contentItem.contentID || contentItem.contentID < 1) return setUnsaved(true)
			setRef({ instanceGuid: instance.guid, kind, id: contentItem.contentID, locale })
			const v = contentItem.values ?? {}
			const key = Object.keys(v).find((k) => TITLE_KEYS.includes(k.toLowerCase()) && typeof v[k] === "string")
			setTitle(key ? v[key] : contentItem.referenceName)
			return
		}
		// The SDK drops the host's pageItem from its context, so ask for it (agility-cms-app-sdk docs/surfaces.md).
		pageMethods.getPageItem()?.then((p) => {
			if (!p) return
			// ItemContainerID is the page's id, as in /pages/page-{id}. (Unverified against every page type: plan §8.)
			setRef({ instanceGuid: instance.guid, kind, id: p.ItemContainerID, locale })
			setTitle(p.Title || p.PageName)
		})
	}, [initializing, instance?.guid, locale, contentItem, kind])

	return { initializing, ref, title, unsaved }
}
