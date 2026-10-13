"use client"

import { closeModal, useAgilityAppSDK } from "@agility/app-sdk"
import { useEffect, useState } from "react"

import type { Container, CreateField } from "@/lib/core/types"
import { useApi, type ContentRefLite } from "@/lib/work-client"
import { Button, Gate, Notice, Spinner, inputClass } from "./ui.client"
import { describe, type DialogResult } from "./work-panel.client"

/**
 * Create an issue from the content, prefilled: its title, and a description with what it is and a link back. The
 * project's required fields are discovered when a project is picked. Phase 1 handles text, date and option fields;
 * anything else that's required makes the form say so rather than fail at submit. Plan §4.1.
 */
export const CreateIssue = () => {
	const { initializing, instance, modalProps } = useAgilityAppSDK()
	const props = modalProps as { ref: ContentRefLite; title: string; provider?: string } | undefined
	const api = useApi(instance?.guid)

	const [projects, setProjects] = useState<Container[] | null>(null)
	const [projectId, setProjectId] = useState("")
	const [schema, setSchema] = useState<{ types: { id: string; name: string }[]; typeId: string; fields: CreateField[] } | null>(null)
	const [typeId, setTypeId] = useState("")
	const [title, setTitle] = useState("")
	const [description, setDescription] = useState("")
	const [extra, setExtra] = useState<Record<string, string>>({})
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (initializing || !props) return
		setTitle(props.title ? `Update: ${props.title}` : "")
		setDescription(
			`Content: ${props.title || `${props.ref.kind} ${props.ref.id}`} (${props.ref.locale})\nCreated from Agility CMS. The issue links back to it.`
		)
		api<{ containers: Container[] }>("/api/containers").then((r) => setProjects(r.containers), (e) => setError(describe(e)))
	}, [initializing, props, api])

	useEffect(() => {
		if (!projectId) return setSchema(null)
		setSchema(null)
		api<typeof schema>(`/api/containers/${projectId}/schema${typeId ? `?typeId=${typeId}` : ""}`).then(
			(s) => {
				setSchema(s)
				if (!typeId && s) setTypeId(s.typeId)
			},
			(e) => setError(describe(e))
		)
	}, [projectId, typeId, api])

	const required = schema?.fields.filter((f) => f.required) ?? []
	const unsupported = required.filter((f) => f.kind === "unsupported" || f.kind === "user")

	const submit = async () => {
		setBusy(true)
		setError(null)
		try {
			const extraFields = Object.fromEntries(
				required
					.filter((f) => extra[f.id])
					.map((f) => [f.id, f.kind === "option" ? { id: extra[f.id] } : extra[f.id]])
			)
			await api("/api/tasks", {
				method: "POST",
				body: JSON.stringify({ ctx: { ref: props?.ref, title: props?.title }, input: { containerId: projectId, typeId, title, description, extraFields } })
			})
			closeModal({ changed: true } satisfies DialogResult)
		} catch (e) {
			setError(describe(e))
			setBusy(false)
		}
	}

	const field = inputClass

	return (
		<Gate initializing={initializing} title="Create an issue">
			<div className="space-y-3 p-4 text-sm">
				{error && <Notice tone="error" title="Something went wrong">{error}</Notice>}
				{projects === null ? (
					<Spinner />
				) : (
					<label className="block">
						<span className="text-xs font-semibold text-[var(--ads-text-subtle)]">Project</span>
						<select className={field} value={projectId} onChange={(e) => (setTypeId(""), setProjectId(e.target.value))}>
							<option value="">Choose a project…</option>
							{projects.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name} {p.key ? `(${p.key})` : ""}
								</option>
							))}
						</select>
					</label>
				)}

				{projectId && !schema && <Spinner />}
				{schema && (
					<>
						<label className="block">
							<span className="text-xs font-semibold text-[var(--ads-text-subtle)]">Type</span>
							<select className={field} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
								{schema.types.map((t) => (
									<option key={t.id} value={t.id}>
										{t.name}
									</option>
								))}
							</select>
						</label>
						<label className="block">
							<span className="text-xs font-semibold text-[var(--ads-text-subtle)]">Summary</span>
							<input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
						</label>
						<label className="block">
							<span className="text-xs font-semibold text-[var(--ads-text-subtle)]">Description</span>
							<textarea className={`${field} h-28`} value={description} onChange={(e) => setDescription(e.target.value)} />
						</label>
						{required
							.filter((f) => f.kind !== "unsupported" && f.kind !== "user")
							.map((f) => (
								<label key={f.id} className="block">
									<span className="text-xs font-semibold text-[var(--ads-text-subtle)]">{f.name}</span>
									{f.kind === "option" ? (
										<select className={field} value={extra[f.id] ?? ""} onChange={(e) => setExtra({ ...extra, [f.id]: e.target.value })}>
											<option value="">Choose…</option>
											{f.options?.map((o) => (
												<option key={o.id} value={o.id}>
													{o.name}
												</option>
											))}
										</select>
									) : (
										<input
											type={f.kind === "date" ? "date" : "text"}
											className={field}
											value={extra[f.id] ?? ""}
											onChange={(e) => setExtra({ ...extra, [f.id]: e.target.value })}
										/>
									)}
								</label>
							))}
						{unsupported.length > 0 && (
							<Notice title="This issue type needs fields the app can't fill yet">
								{unsupported.map((f) => f.name).join(", ")}. Create the issue in {props?.provider ?? "Jira"} and link it instead.
							</Notice>
						)}
					</>
				)}

				<div className="flex justify-end gap-2">
					<Button kind="subtle" onClick={() => closeModal({ changed: false } satisfies DialogResult)}>
						Cancel
					</Button>
					<Button kind="primary" disabled={busy || !schema || !title.trim() || unsupported.length > 0} onClick={submit}>
						{busy ? "Creating…" : "Create and link"}
					</Button>
				</div>
			</div>
		</Gate>
	)
}
