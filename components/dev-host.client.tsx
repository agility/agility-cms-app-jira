"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * A stand-in for the Agility Manager App, for local development: it implements the host half of the iframe protocol
 * these surfaces use (initialize/context, getManagementAPIToken, getPageItem, openModal/closeModal, setHeight), in
 * the wire format of agility-cms-manager-app-react's useAppSurfaceMessages.ts, which is the real contract.
 *
 * It hands out the token "dev", which the backend accepts only with WORK_DEV_CALLER=1 outside production. Pair it
 * with WORK_PROVIDER=mock and the whole app runs with no Agility instance and no Atlassian site.
 */

const APP_ID = "dev-app"
const GUID = "00000000-u"

interface Msg {
	appID?: string
	operationID?: string
	operationType?: string
	arg?: any
}

export const DevHost = () => {
	const [surface, setSurface] = useState<"item" | "page">("item")
	const [modal, setModal] = useState<{ name: string; title: string; props: any; closeModalID: string } | null>(null)
	const [log, setLog] = useState<string[]>([])
	const panel = useRef<HTMLIFrameElement>(null)
	const modalFrame = useRef<HTMLIFrameElement>(null)
	const modalRef = useRef(modal)
	modalRef.current = modal

	const note = useCallback((l: string) => setLog((x) => [`${new Date().toLocaleTimeString()}  ${l}`, ...x].slice(0, 30)), [])
	const post = (f: HTMLIFrameElement | null, m: Msg) => f?.contentWindow?.postMessage(m, "*")

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const d = event.data as Msg
			if (!d?.operationType || d.appID !== APP_ID) return
			const fromModal = event.source === modalFrame.current?.contentWindow
			const target = fromModal ? modalFrame.current : panel.current
			const reply = (operationType: string, arg: any) => post(target, { appID: APP_ID, operationID: d.operationID, operationType, arg })

			switch (d.operationType) {
				case "initialize":
					reply("context", {
						app: { appID: APP_ID, configuration: { jiraSite: "tracker.example" } },
						instance: { guid: GUID, websiteName: "Dev Instance" },
						locale: "en-us",
						...(fromModal
							? { modalProps: modalRef.current?.props }
							: surface === "item"
								? { contentItem: { contentID: 208, referenceName: "posts", values: { Heading: "5 Practical Steps to Ship Faster" } }, contentModel: { id: 11, referenceName: "Post" } }
								: { pageItem: { ItemContainerID: 2, Title: "Home", PageName: "home" } })
					})
					break
				case "getManagementAPIToken":
					reply("getManagementAPIToken", { token: "dev" })
					break
				case "getPageItem":
					reply("getPageItem", { ItemContainerID: 2, Title: "Home", PageName: "home" })
					break
				case "openModal":
					setModal({ name: d.arg?.name, title: d.arg?.title ?? "", props: d.arg?.props, closeModalID: d.arg?.closeModalID })
					break
				case "closeModal":
					setModal(null)
					post(panel.current, { appID: APP_ID, operationID: d.arg?.closeModalID, operationType: "openModal", arg: d.arg })
					break
				default:
					break
			}
			if (d.operationType !== "setHeight") note(`${fromModal ? "modal" : "panel"} → ${d.operationType}`)
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [surface, note])

	return (
		<main className="mx-auto max-w-5xl px-6 py-8">
			<h1 className="text-xl font-semibold text-gray-900">Jira Issues — local host</h1>
			<p className="mt-1 text-sm text-gray-600">A stand-in for the Agility Manager App. Not part of the shipped app.</p>
			<div className="mt-4 flex gap-2 text-sm">
				{(["item", "page"] as const).map((s) => (
					<button key={s} onClick={() => setSurface(s)} className={`rounded-md border px-3 py-1.5 ${surface === s ? "border-gray-900 font-semibold" : "border-gray-300"}`}>
						{s === "item" ? "Content item sidebar" : "Page sidebar"}
					</button>
				))}
			</div>
			<div className="mt-4 grid gap-6 lg:grid-cols-[360px_1fr]">
				<iframe key={surface} ref={panel} src={`/${surface === "item" ? "content-item" : "page"}-sidebar?appID=${APP_ID}`} className="h-[640px] w-full rounded-xl border border-gray-200 bg-white" title="sidebar" />
				<pre className="h-[640px] overflow-auto rounded-xl bg-gray-50 p-3 text-xs text-gray-600">{log.join("\n")}</pre>
			</div>
			{modal && (
				<div className="fixed inset-0 flex items-center justify-center bg-black/30">
					<div className="w-[560px] rounded-xl bg-white shadow-xl">
						<div className="border-b border-gray-200 px-4 py-3 font-semibold">{modal.title}</div>
						<iframe ref={modalFrame} src={`/modals/${modal.name}?appID=${APP_ID}&closeModalID=${modal.closeModalID}`} className="h-[520px] w-full" title="modal" />
					</div>
				</div>
			)}
		</main>
	)
}
