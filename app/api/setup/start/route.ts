import { NextResponse } from "next/server"

import { AuthError } from "@/lib/agility/identity"
import { isInstanceAdmin } from "@/lib/agility/roles"
import { withCaller } from "@/lib/http"
import { adapter, redirectUri, signState } from "@/lib/work"

/**
 * Admin only: the consent URL for authorizing the provider site for the whole instance. `site` is the Jira site from
 * the app's config (Settings › Apps), which the panel reads from its install context; the callback binds the instance
 * to exactly that site, or fails naming the sites the account can reach.
 */
export const POST = withCaller(async (req, caller) => {
	if (!(await isInstanceAdmin(caller))) throw new AuthError("Only an Agility admin can authorize this app for the instance.")
	const { site } = await req.json().catch(() => ({ site: undefined }))
	if (!site || typeof site !== "string") throw new Error("Set the Jira site in the app's settings first (Settings › Apps).")
	const a = adapter()
	return NextResponse.json({ url: a.authorizeUrl(signState(caller, a.id, "admin", site.trim()), redirectUri()) })
})
