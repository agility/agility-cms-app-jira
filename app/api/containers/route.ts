import { NextResponse } from "next/server"

import { withCaller } from "@/lib/http"
import { adapter, connectionFor, sessionFor } from "@/lib/work"

/** GET: the projects (boards, teams) an issue can be created in. */
export const GET = withCaller(async (_req, caller) => {
	const s = await sessionFor(await connectionFor(caller))
	return NextResponse.json({ containers: await adapter().listContainers(s) })
})
