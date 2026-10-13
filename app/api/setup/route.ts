import { NextResponse } from "next/server"

import { isInstanceAdmin } from "@/lib/agility/roles"
import { AuthError } from "@/lib/agility/identity"
import { withCaller } from "@/lib/http"
import { getSetup, removeSetup } from "@/lib/work"

/** GET: is the provider authorized for this instance, and can the caller (an admin) change that. DELETE: remove it. */
export const GET = withCaller(async (_req, caller) => {
	const [setup, admin] = await Promise.all([getSetup(caller.instanceGuid), isInstanceAdmin(caller)])
	return NextResponse.json({
		isAdmin: admin,
		setup: setup ? { siteName: setup.siteName, siteUrl: setup.siteUrl, authorizedByName: setup.authorizedByName, authorizedAt: setup.authorizedAt } : null
	})
})

export const DELETE = withCaller(async (_req, caller) => {
	if (!(await isInstanceAdmin(caller))) throw new AuthError("Only an Agility admin can remove the authorization.")
	await removeSetup(caller.instanceGuid)
	return NextResponse.json({ ok: true })
})
