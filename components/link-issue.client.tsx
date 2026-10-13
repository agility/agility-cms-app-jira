"use client"

import { closeModal, useAgilityAppSDK } from "@agility/app-sdk"
import { useEffect, useState } from "react"

import type { Task } from "@/lib/core/types"
import { useApi, type ContentRefLite } from "@/lib/work-client"
import { Button, Gate, Notice, Spinner, TaskLine, inputClass } from "./ui.client"
import { describe, type DialogResult } from "./work-panel.client"

const done = (r: DialogResult) => closeModal(r)

/** Search by text, key or pasted link, then link the chosen issue. The search waits for typing to pause. */
export const LinkIssue = () => {
	const { initializing, instance, modalProps } = useAgilityAppSDK()
	const props = modalProps as { ref: ContentRefLite; title: string; provider?: string } | undefined
	const api = useApi(instance?.guid)

	const [q, setQ] = useState("")
	const [results, setResults] = useState<Task[] | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (initializing) return
		const t = setTimeout(async () => {
			try {
				setResults((await api<{ tasks: Task[] }>(`/api/tasks/search?q=${encodeURIComponent(q)}`)).tasks)
			} catch (e) {
				setError(describe(e))
			}
		}, 300)
		return () => clearTimeout(t)
	}, [q, api, initializing])

	const link = async (task: Task) => {
		setBusy(true)
		setError(null)
		try {
			await api("/api/links", { method: "POST", body: JSON.stringify({ ctx: { ref: props?.ref, title: props?.title }, query: task.key ?? task.externalId }) })
			done({ changed: true })
		} catch (e) {
			setError(describe(e))
			setBusy(false)
		}
	}

	return (
		<Gate initializing={initializing} title="Link an issue">
			<div className="space-y-3 p-4 text-sm">
				<input
					autoFocus
					className={inputClass}
					placeholder={`Search ${props?.provider ?? "Jira"}, or paste a key or link`}
					value={q}
					onChange={(e) => setQ(e.target.value)}
				/>
				{error && <Notice tone="error" title="Something went wrong">{error}</Notice>}
				{results === null ? (
					<Spinner />
				) : results.length === 0 ? (
					<p className="text-[var(--ads-text-subtle)]">No issues match.</p>
				) : (
					<ul className="max-h-80 overflow-auto rounded-[3px] border" style={{ borderColor: "var(--ads-border)" }}>
						{results.map((t) => (
							<li key={t.externalId} className="flex items-start gap-2 border-b p-2.5 last:border-b-0 hover:bg-[var(--ads-bg-neutral)]" style={{ borderColor: "var(--ads-border)" }}>
								<div className="min-w-0 flex-1">
									<TaskLine task={t} />
								</div>
								<Button disabled={busy} onClick={() => link(t)}>
									Link
								</Button>
							</li>
						))}
					</ul>
				)}
				<div className="flex justify-end">
					<Button kind="subtle" onClick={() => done({ changed: false })}>
						Cancel
					</Button>
				</div>
			</div>
		</Gate>
	)
}
