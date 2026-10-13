import { NextResponse } from "next/server"

import { withCaller } from "@/lib/http"
import { adapter, connectionFor, sessionFor } from "@/lib/work"

/** GET ?q=: issues matching text, a key or a pasted link, for the Link dialog. */
export const GET = withCaller(async (req, caller) => {
	const s = await sessionFor(await connectionFor(caller))
	return NextResponse.json({ tasks: await adapter().searchTasks(s, req.nextUrl.searchParams.get("q") ?? "", 10) })
})
