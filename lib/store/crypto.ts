import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * Envelope for provider tokens at rest: AES-256-GCM with a key from WORK_TOKEN_KEY (32 bytes, base64).
 *
 * Tokens are long-lived secrets (a Jira refresh token works until 90 days of disuse), so they are encrypted before they
 * reach any store, and never sent to the browser. Agility's own app config is no place for them: every editor's
 * browser can read install configuration (system-overview plans/n8n-workflow-automation.md §4.5).
 *
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */

const keyFrom = (b64: string | undefined): Buffer => {
	if (!b64) throw new Error("WORK_TOKEN_KEY is not set: generate one with `openssl rand -base64 32`.")
	const key = Buffer.from(b64, "base64")
	if (key.length !== 32) throw new Error("WORK_TOKEN_KEY must decode to exactly 32 bytes.")
	return key
}

export const seal = (plaintext: string, keyB64 = process.env.WORK_TOKEN_KEY): string => {
	const key = keyFrom(keyB64)
	const iv = randomBytes(12)
	const c = createCipheriv("aes-256-gcm", key, iv)
	const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()])
	return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".")
}

export const open = (sealed: string, keyB64 = process.env.WORK_TOKEN_KEY): string => {
	const [v, iv, tag, body] = sealed.split(".")
	if (v !== "v1" || !iv || !tag || !body) throw new Error("Not a sealed token.")
	const d = createDecipheriv("aes-256-gcm", keyFrom(keyB64), Buffer.from(iv, "base64url"))
	d.setAuthTag(Buffer.from(tag, "base64url"))
	return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8")
}
