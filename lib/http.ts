import "server-only"

import { NextResponse, type NextRequest } from "next/server"

import { AuthError, verifyCaller, type AgilityCaller } from "./agility/identity.ts"
import type { ContentRef } from "./core/types.ts"
import { JiraRateLimitError } from "./providers/jira/adapter.ts"
import { NotAuthorizedError, NotConnectedError } from "./work.ts"

/**
 * Every app route: verify the Agility editor (token + instance header), run the handler, and turn known failures
 * into responses the panel understands: 401 not signed in to Agility, 409 not connected to the provider, 429 the
 * provider's rate limit.
 */
export const withCaller =
	<C = unknown>(handler: (req: NextRequest, caller: AgilityCaller, ctx: C) => Promise<Response>) =>
	async (req: NextRequest, ctx: C) => {
		try {
			const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null
			const caller = await verifyCaller(token, req.headers.get("x-agility-instance"))
			return await handler(req, caller, ctx)
		} catch (e) {
			return errorResponse(e)
		}
	}

export const errorResponse = (e: unknown) => {
	if (e instanceof AuthError) return NextResponse.json({ error: "unauthorized", message: e.message }, { status: 401 })
	if (e instanceof NotAuthorizedError) return NextResponse.json({ error: "not_authorized" }, { status: 409 })
	if (e instanceof NotConnectedError) return NextResponse.json({ error: "not_connected" }, { status: 409 })
	if (e instanceof JiraRateLimitError)
		return NextResponse.json({ error: "rate_limited", retryAfter: e.retryAfterSeconds }, { status: 429 })
	console.error(e)
	return NextResponse.json({ error: "failed", message: e instanceof Error ? e.message : String(e) }, { status: 502 })
}

/** The content a GET or DELETE is about. It must be on the caller's own instance. Writes use resolveContent instead. */
export const contentRefFrom = (raw: any, caller: AgilityCaller): ContentRef => {
	const ref: ContentRef = {
		instanceGuid: String(raw?.instanceGuid ?? ""),
		kind: raw?.kind === "page" ? "page" : "item",
		id: Number(raw?.id),
		locale: String(raw?.locale ?? "").toLowerCase()
	}
	if (ref.instanceGuid !== caller.instanceGuid) throw new AuthError("That content is on a different instance.")
	if (!Number.isInteger(ref.id) || ref.id <= 0 || !/^[a-z]{2}(-[a-z0-9]+)*$/.test(ref.locale)) throw new Error("Bad content reference.")
	return ref
}
