import { NextResponse } from "next/server"

import { withCaller } from "@/lib/http"
import { adapter, connectionFor, sessionFor } from "@/lib/work"

/** GET ?typeId=: the issue types a project offers and the fields one of them requires. */
export const GET = withCaller<{ params: Promise<{ id: string }> }>(async (req, caller, { params }) => {
	const { id } = await params
	const s = await sessionFor(await connectionFor(caller))
	return NextResponse.json(await adapter().getCreateSchema(s, id, req.nextUrl.searchParams.get("typeId") ?? undefined))
})
