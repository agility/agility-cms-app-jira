import { NextResponse } from "next/server"

import { withCaller } from "@/lib/http"
import { adapter, disconnect, getSetup, store } from "@/lib/work"

/** GET: is this editor connected, and as whom. DELETE: disconnect (revokes where the provider supports it). */
export const GET = withCaller(async (_req, caller) => {
	const setup = await getSetup(caller.instanceGuid)
	const own = await store().getConnection(caller.instanceGuid, caller.userId, adapter().id)
	// A connection to a different site than the one authorized doesn't count: the editor has to reconnect.
	const c = own && setup && own.siteId === setup.siteId ? own : null
	return NextResponse.json({
		authorized: Boolean(setup),
		provider: { id: adapter().id, label: adapter().label },
		connection: c ? { siteName: c.siteName, siteUrl: c.siteUrl, account: c.account, connectedAt: c.connectedAt } : null
	})
})

export const DELETE = withCaller(async (_req, caller) => {
	await disconnect(caller)
	return NextResponse.json({ ok: true })
})
