import { NextResponse } from "next/server"

import { withCaller } from "@/lib/http"
import { adapter, getSetup, NotAuthorizedError, redirectUri, signState } from "@/lib/work"

/**
 * Step 1 of connecting: the panel asks for the provider's consent URL and opens it in a popup. The popup can't carry
 * the Agility token, so who started the connect travels in the signed `state` instead.
 */
export const POST = withCaller(async (_req, caller) => {
	if (!(await getSetup(caller.instanceGuid))) throw new NotAuthorizedError()
	const a = adapter()
	return NextResponse.json({ url: a.authorizeUrl(signState(caller, a.id), redirectUri()) })
})
