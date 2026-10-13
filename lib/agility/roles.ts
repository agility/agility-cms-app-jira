import "server-only"

import { isDevCaller, mgmtBaseUrl, type AgilityCaller } from "./identity.ts"

/**
 * Is the caller an Agility admin on this instance? Real roles live in the instance's user/role join, which the
 * Management API returns per user (userRoles). `Users.jobRole` is self-declared text and must not be used
 * (system-overview memory: "Agility permission model"). An org admin counts too.
 *
 * A user who isn't allowed to list users gets a 403 here, which is itself a "no".
 */
export const isInstanceAdmin = async (caller: AgilityCaller, f: typeof fetch = fetch): Promise<boolean> => {
	if (isDevCaller(caller.token)) return process.env.WORK_DEV_ADMIN !== "0"
	const res = await f(`${mgmtBaseUrl(caller.instanceGuid)}/api/v1/instance/${caller.instanceGuid}/user/list`, {
		headers: { Authorization: `Bearer ${caller.token}`, Accept: "application/json" }
	})
	if (!res.ok) return false
	const users = (await res.json()) as { userID: number; isOrgAdmin?: boolean; userRoles?: { role?: string; name?: string }[] }[]
	const me = users.find((u) => u.userID === caller.userId)
	if (!me) return false
	return Boolean(me.isOrgAdmin) || (me.userRoles ?? []).some((r) => /^administrator$/i.test(r.role ?? r.name ?? ""))
}
