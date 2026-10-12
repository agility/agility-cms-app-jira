import type { NextRequest } from "next/server"

import { completeConnect } from "@/lib/work"

/**
 * Step 2: the provider sends the popup back here. Store the connection, tell the panel (window.opener) and close.
 * The message carries no secrets: the panel just refetches /api/connection.
 */
export async function GET(req: NextRequest) {
	const code = req.nextUrl.searchParams.get("code")
	const state = req.nextUrl.searchParams.get("state")
	let message: { type: string; ok: boolean; error?: string }
	try {
		if (!code || !state) throw new Error(req.nextUrl.searchParams.get("error_description") ?? "The provider didn't return a code.")
		await completeConnect(code, state)
		message = { type: "agility-work:connected", ok: true }
	} catch (e) {
		message = { type: "agility-work:connected", ok: false, error: e instanceof Error ? e.message : String(e) }
	}
	const html = `<!doctype html><meta charset="utf-8"><title>Connecting…</title>
<body style="font:14px system-ui;padding:24px">${message.ok ? "Connected. You can close this window." : `Couldn't connect: ${escapeHtml(message.error ?? "")}`}
<script>try{window.opener&&window.opener.postMessage(${JSON.stringify(message)},"*")}catch(e){}${message.ok ? "setTimeout(()=>window.close(),400)" : ""}</script>`
	return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
