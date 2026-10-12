"use client"

import { openModal } from "@agility/app-sdk"
import { useCallback, useEffect, useState } from "react"

import type { Link, Person } from "@/lib/core/types"
import { ApiError, useApi, useContentRef } from "@/lib/work-client"
import { useAgilityAppSDK } from "@agility/app-sdk"
import { Button, Gate, Notice, Spinner, TaskLine, inputClass } from "./ui.client"

interface ConnectionInfo {
	provider: { id: string; label: string }
	authorized: boolean
	connection: { siteName: string; siteUrl: string; account: Person } | null
}

interface SetupInfo {
	isAdmin: boolean
	setup: { siteName: string; siteUrl: string; authorizedByName: string; authorizedAt: string } | null
}

/** What the dialogs hand back through closeModal. Always an object: the SDK treats a falsy result as an error. */
export interface DialogResult {
	changed: boolean
}

/**
 * The Work panel: the issues linked to this item or page, live status from the link snapshots, and the ways in
 * (link an existing issue, create one from this content). Plan §4.1.
 */
export const WorkPanel = ({ kind }: { kind: "item" | "page" }) => {
	const { instance, appInstallContext } = useAgilityAppSDK()
	// The Jira site an admin named in Settings › Apps; authorizing binds the instance to exactly this site.
	const configuredSite = appInstallContext?.configuration?.jiraSite?.trim() || ""
	const { initializing, ref, title, unsaved } = useContentRef(kind)
	const api = useApi(instance?.guid)

	const [info, setInfo] = useState<ConnectionInfo | null>(null)
	const [setup, setSetup] = useState<SetupInfo | null>(null)
	const [links, setLinks] = useState<Link[] | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		if (!ref) return
		setError(null)
		try {
			const [c, s] = await Promise.all([api<ConnectionInfo>("/api/connection"), api<SetupInfo>("/api/setup")])
			setInfo(c)
			setSetup(s)
			if (c.connection) setLinks((await api<{ links: Link[] }>(`/api/links?ref=${encodeURIComponent(JSON.stringify(ref))}`)).links)
		} catch (e) {
			setError(describe(e))
		}
	}, [api, ref])

	useEffect(() => {
		load()
	}, [load])

	// The connect popup reports back with a postMessage, then closes.
	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.data?.type !== "agility-work:connected") return
			if (!e.data.ok) setError(e.data.error ?? "Couldn't connect.")
			load()
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [load])

	const act = async (fn: () => Promise<unknown>) => {
		setBusy(true)
		setError(null)
		try {
			await fn()
		} catch (e) {
			setError(describe(e))
		} finally {
			setBusy(false)
		}
	}

	const popup = (url: string) => window.open(url, "agility-work-connect", "width=560,height=720")
	const connect = () => act(async () => popup((await api<{ url: string }>("/api/connect/start", { method: "POST" })).url))
	const authorize = () =>
		act(async () => popup((await api<{ url: string }>("/api/setup/start", { method: "POST", body: JSON.stringify({ site: configuredSite }) })).url))

	const dialog = (name: "link-issue" | "create-issue", dialogTitle: string) =>
		openModal<DialogResult>({
			name,
			title: dialogTitle,
			props: { ref, title, provider: info?.provider.label },
			callback: (r) => {
				if (r?.changed) load()
			}
		})

	const label = info?.provider.label ?? "Jira"

	return (
		<Gate initializing={initializing} title={`${label} issues`}>
			<div className="space-y-3 p-3 text-sm">
				{unsaved && <Notice title="Save this item first">Issues can be linked once it has been saved.</Notice>}
				{error && <Notice tone="error" title="Something went wrong">{error}</Notice>}

				{!unsaved && !info && !error && (
					<div className="flex justify-center py-4">
						<Spinner />
					</div>
				)}

				{info && setup && !info.authorized && (
					<div className="space-y-2">
						{setup.isAdmin ? (
							configuredSite ? (
								<>
									<p className="text-[var(--ads-text-subtle)]">
										Authorize <span className="font-semibold text-[var(--ads-text)]">{configuredSite}</span> for this Agility instance. You sign
										in to {label} as yourself; after that, each editor connects their own account to this site.
									</p>
									<Button kind="primary" onClick={authorize} disabled={busy}>
										Authorize {label}
									</Button>
								</>
							) : (
								<Notice title={`Set your ${label} site first`}>
									Add it under Settings › Apps › {label} Issues (for example acme.atlassian.net), then come back here to authorize it.
								</Notice>
							)
						) : (
							<Notice title={`${label} isn't set up for this instance yet`}>Ask an Agility admin to authorize it. It only takes a minute.</Notice>
						)}
					</div>
				)}

				{info && info.authorized && !info.connection && (
					<div className="space-y-2">
						<p className="text-[var(--ads-text-subtle)]">
							Connect your {label} account on <span className="font-semibold text-[var(--ads-text)]">{setup?.setup?.siteName}</span> to link issues to
							this {kind === "page" ? "page" : "item"} and create new ones from it.
							You sign in as yourself, so {label} shows your name on anything you do.
						</p>
						<Button kind="primary" onClick={connect} disabled={busy}>
							Connect {label}
						</Button>
					</div>
				)}

				{info?.connection && (
					<>
						<div className="flex items-center gap-2">
							<h2 className="text-xs font-semibold tracking-wide text-[var(--ads-text-subtle)] uppercase">
								{label} issues{links ? ` · ${links.length}` : ""}
							</h2>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button kind="primary" onClick={() => dialog("create-issue", `Create a ${label} issue`)} disabled={busy}>
								Create issue
							</Button>
							<Button onClick={() => dialog("link-issue", `Link a ${label} issue`)} disabled={busy}>
								Link issue
							</Button>
							<Button
								kind="subtle"
								disabled={busy || !ref}
								onClick={() =>
									act(async () => setLinks((await api<{ links: Link[] }>("/api/links/refresh", { method: "POST", body: JSON.stringify({ ref }) })).links))
								}
							>
								Refresh
							</Button>
						</div>

						{links === null ? (
							<Spinner />
						) : links.length === 0 ? (
							<p className="text-[var(--ads-text-subtle)]">No issues linked to this {kind === "page" ? "page" : "item"} yet.</p>
						) : (
							<ul className="overflow-hidden rounded-[3px] border" style={{ borderColor: "var(--ads-border)" }}>
								{links.map((l) => (
									<li key={l.id} className="flex items-start gap-2 border-b p-2.5 last:border-b-0 hover:bg-[var(--ads-bg-neutral)]" style={{ borderColor: "var(--ads-border)" }}>
										<div className="min-w-0 flex-1">
											<TaskLine task={l.snapshot} />
										</div>
										<button
											className="text-xs text-[var(--ads-text-subtle)] hover:text-[var(--ads-text)]"
											title="Unlink this issue"
											disabled={busy}
											onClick={() =>
												act(async () => {
													await api(`/api/links/${l.id}?ref=${encodeURIComponent(JSON.stringify(ref))}`, { method: "DELETE" })
													setLinks((ls) => ls?.filter((x) => x.id !== l.id) ?? null)
												})
											}
										>
											Unlink
										</button>
									</li>
								))}
							</ul>
						)}

						<p className="text-xs text-[var(--ads-text-subtle)]">
							Connected to {info.connection.siteName} as {info.connection.account.name} ·{" "}
							<button className="underline hover:text-[var(--ads-link)]" onClick={() => act(async () => (await api("/api/connection", { method: "DELETE" }), load()))}>
								Disconnect
							</button>
							{setup?.setup && (
								<>
									<br />
									Authorized for this instance by {setup.setup.authorizedByName || "an admin"}
									{setup.isAdmin && (
										<>
											{" · "}
											<button className="underline hover:text-[var(--ads-link)]" onClick={() => act(async () => (await api("/api/setup", { method: "DELETE" }), load()))}>
												Remove authorization
											</button>
										</>
									)}
								</>
							)}
						</p>
					</>
				)}
			</div>
		</Gate>
	)
}

export const describe = (e: unknown): string => {
	if (e instanceof ApiError) {
		if (e.status === 401) return "Agility couldn't confirm who you are. Reload the page and try again."
		if (e.status === 409 && e.body?.error === "not_authorized") return "This app isn't authorized for the instance yet. Ask an Agility admin."
		if (e.status === 409) return "Your account isn't connected any more. Connect it again."
		if (e.status === 429) return `The issue tracker is busy. Try again in ${e.body?.retryAfter ?? 60} seconds.`
		return e.body?.message ?? e.message
	}
	return e instanceof Error ? e.message : String(e)
}
