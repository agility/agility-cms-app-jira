import { NextResponse } from "next/server"

import { contentRefFrom, withCaller } from "@/lib/http"
import { unlink } from "@/lib/work"

/** DELETE ?ref=<json>: unlink, and remove our backlink from the issue. */
export const DELETE = withCaller<{ params: Promise<{ id: string }> }>(async (req, caller, { params }) => {
	const { id } = await params
	const ref = contentRefFrom(JSON.parse(req.nextUrl.searchParams.get("ref") ?? "{}"), caller)
	await unlink(caller, ref, id)
	return NextResponse.json({ ok: true })
})
