import { NextResponse, type NextRequest } from "next/server"

import { adapter, handleProviderWebhook } from "@/lib/work"

/**
 * Jira → us. Verified inside the adapter (HS256 JWT signed with the app's client secret) before anything is read.
 * A bad signature is a 401 and changes nothing. Registration and the 30-day renewal job are phase 1 work that waits on
 * the hosting decision (plan §5.4, §12 D2).
 */
export async function POST(req: NextRequest) {
	// Only a Jira deployment has a Jira webhook. (The mock provider verifies nothing, so it must not be reachable.)
	if (adapter().id !== "jira") return new Response("Not found", { status: 404 })
	const raw = await req.text()
	try {
		const n = await handleProviderWebhook(req.headers, raw)
		return NextResponse.json({ ok: true, events: n })
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return NextResponse.json({ error: msg }, { status: /signature/i.test(msg) ? 401 : 500 })
	}
}
