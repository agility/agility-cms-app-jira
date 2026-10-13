import { createHash } from "node:crypto"

/**
 * Who is calling: the Agility editor behind the iframe.
 *
 * The app's pages get the editor's Management API token from the host (getManagementAPIToken) and send it to this
 * backend. We never trust a user id from the browser: we ask the Management API who the token belongs to (users/me),
 * and prove the token can reach this instance (locales). Same pattern as the BFF, which delegates auth to the
 * Management API (system-overview components/bff.md).
 */

export interface AgilityCaller {
	instanceGuid: string
	userId: number
	name: string
	email?: string
	/** The editor's own Management API token, for reads made on their behalf. Never logged, never stored. */
	token: string
}

/** Region from the instance guid's suffix (system-overview components/management-api.md, "Public routing"). */
export const mgmtBaseUrl = (guid: string): string => {
	const suffix = guid.split("-")[1]?.toLowerCase()
	switch (suffix) {
		case "d":
			return "https://mgmt-dev.aglty.io"
		case "us2":
			return "https://mgmt-usa2.aglty.io"
		case "c":
			return "https://mgmt-ca.aglty.io"
		case "e":
			return "https://mgmt-eu.aglty.io"
		case "a":
			return "https://mgmt-aus.aglty.io"
		default:
			return "https://mgmt.aglty.io"
	}
}

const GUID_RE = /^[0-9a-f]{8}-[a-z0-9]{1,3}$/i

// Verified tokens, briefly, so a panel opening and its three requests don't cost six Management API calls.
const cache = new Map<string, { caller: AgilityCaller; until: number }>()
const TTL_MS = 5 * 60_000

export class AuthError extends Error {}

export const isDevCaller = (token: string | null) =>
	token === "dev" && process.env.WORK_DEV_CALLER === "1" && process.env.NODE_ENV !== "production"

export const verifyCaller = async (token: string | null, instanceGuid: string | null, f: typeof fetch = fetch): Promise<AgilityCaller> => {
	if (!token) throw new AuthError("Missing Agility token.")
	if (!instanceGuid || !GUID_RE.test(instanceGuid)) throw new AuthError("Missing or malformed instance guid.")

	// /dev-host only: a fake editor, so the panel can be built without an Agility instance. Never in production.
	if (isDevCaller(token)) return { instanceGuid, userId: 1, name: "Dev editor", token }

	const key = createHash("sha256").update(`${instanceGuid}|${token}`).digest("hex")
	const hit = cache.get(key)
	if (hit && hit.until > Date.now()) return hit.caller

	const base = mgmtBaseUrl(instanceGuid)
	const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" }
	const me = await f(`${base}/api/v1/users/me`, { headers })
	if (!me.ok) throw new AuthError(`Agility rejected the token (${me.status}).`)
	const user = (await me.json()) as { userID: number; firstName?: string; lastName?: string; emailAddress?: string; isSuspended?: boolean }
	if (user.isSuspended) throw new AuthError("This Agility user is suspended.")

	const access = await f(`${base}/api/v1/instance/${instanceGuid}/locales`, { headers })
	if (!access.ok) throw new AuthError(`This user can't access instance ${instanceGuid} (${access.status}).`)

	const caller: AgilityCaller = {
		instanceGuid,
		userId: user.userID,
		name: [user.firstName, user.lastName].filter(Boolean).join(" ") || `User ${user.userID}`,
		email: user.emailAddress,
		token
	}
	cache.set(key, { caller, until: Date.now() + TTL_MS })
	return caller
}
