import { NextResponse } from "next/server"

import { contentRefFrom, withCaller } from "@/lib/http"
import { refreshLinks } from "@/lib/work"

/** POST {ref}: re-read the linked issues from the provider (the panel's Refresh button). */
export const POST = withCaller(async (req, caller) => {
	const body = await req.json()
	return NextResponse.json({ links: await refreshLinks(caller, contentRefFrom(body.ref, caller)) })
})
