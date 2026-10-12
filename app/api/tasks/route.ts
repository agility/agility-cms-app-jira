import { NextResponse } from "next/server"

import { resolveContent } from "@/lib/agility/content"
import { withCaller } from "@/lib/http"
import { createAndLink } from "@/lib/work"

/** POST {ctx, input}: create an issue from the content, already linked to it. */
export const POST = withCaller(async (req, caller) => {
	const body = await req.json()
	const i = body.input ?? {}
	const link = await createAndLink(caller, await resolveContent(body.ctx, caller), {
		containerId: String(i.containerId ?? ""),
		typeId: i.typeId ? String(i.typeId) : undefined,
		title: String(i.title ?? "").trim() || "Untitled",
		description: String(i.description ?? ""),
		dueDate: i.dueDate ? String(i.dueDate) : undefined,
		extraFields: typeof i.extraFields === "object" && i.extraFields ? i.extraFields : undefined
	})
	return NextResponse.json({ link })
})
