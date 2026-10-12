import { NextResponse } from "next/server"

import { resolveContent } from "@/lib/agility/content"
import { contentRefFrom, withCaller } from "@/lib/http"
import { linkTask, listLinks } from "@/lib/work"

/** GET ?ref=<json>: the content's links, from snapshots (no provider call). POST {ctx, query}: link an existing issue. */
export const GET = withCaller(async (req, caller) => {
	const ref = contentRefFrom(JSON.parse(req.nextUrl.searchParams.get("ref") ?? "{}"), caller)
	return NextResponse.json({ links: await listLinks(ref) })
})

export const POST = withCaller(async (req, caller) => {
	const body = await req.json()
	const link = await linkTask(caller, await resolveContent(body.ctx, caller), String(body.query ?? ""))
	return NextResponse.json({ link })
})
