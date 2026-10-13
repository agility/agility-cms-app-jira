"use client"

import { useEffect, useState } from "react"

import type { Person, StatusCategory, Task } from "@/lib/core/types"

/**
 * The app's UI kit, in Jira's visual idiom (see globals.css): lozenges for status, issue-type and priority icons,
 * blue keys, initials avatars, Atlassian-blue primary buttons. Colours come from the --ads-* tokens only.
 */

export const Spinner = ({ className = "h-4 w-4" }: { className?: string }) => (
	<span
		className={`inline-block animate-spin rounded-full border-2 ${className}`}
		style={{ borderColor: "var(--ads-bg-neutral-hovered)", borderTopColor: "var(--ads-bg-brand)" }}
		role="status"
		aria-label="Loading"
	/>
)

export const StandaloneNotice = ({ title }: { title: string }) => (
	<div className="m-4 rounded-md p-5 text-sm" style={{ background: "var(--ads-bg-neutral)" }}>
		<p className="font-semibold">{title}</p>
		<p className="mt-1.5" style={{ color: "var(--ads-text-subtle)" }}>
			This page is part of an Agility CMS app. It only works inside the Agility Manager App, which loads it in an iframe and
			passes an <code className="rounded px-1 py-0.5 text-xs" style={{ background: "var(--ads-bg-neutral-hovered)" }}>appID</code> on the URL.
		</p>
	</div>
)

/** Renders children once the SDK handshake lands, and explains itself if it never does. */
export const Gate = ({ initializing, title, children }: { initializing: boolean; title: string; children: React.ReactNode }) => {
	const [gaveUp, setGaveUp] = useState(false)
	useEffect(() => {
		if (!initializing) return
		const t = setTimeout(() => setGaveUp(true), 1500)
		return () => clearTimeout(t)
	}, [initializing])
	if (!initializing) return <>{children}</>
	if (gaveUp) return <StandaloneNotice title={title} />
	return (
		<div className="flex h-16 items-center justify-center">
			<Spinner />
		</div>
	)
}

const LOZENGE: Record<StatusCategory, { bg: string; fg: string }> = {
	todo: { bg: "var(--ads-lozenge-todo-bg)", fg: "var(--ads-lozenge-todo-text)" },
	in_progress: { bg: "var(--ads-lozenge-progress-bg)", fg: "var(--ads-lozenge-progress-text)" },
	done: { bg: "var(--ads-lozenge-done-bg)", fg: "var(--ads-lozenge-done-text)" }
}

/** Jira's status lozenge: uppercase, bold, 11px, coloured by status category (the status name is the tool's own). */
export const StatusPill = ({ category, label }: { category: StatusCategory; label: string }) => (
	<span
		className="inline-block max-w-[10rem] truncate rounded-[3px] px-1 text-[11px] leading-4 font-bold uppercase"
		style={{ background: LOZENGE[category].bg, color: LOZENGE[category].fg }}
		title={label}
	>
		{label || category.replace("_", " ")}
	</span>
)

/** Issue-type icon, drawn in Jira's idiom: blue check (task), red dot (bug), green bookmark (story), purple bolt (epic). */
export const TypeIcon = ({ type }: { type?: string }) => {
	const t = (type ?? "task").toLowerCase()
	const box = (fill: string, path: React.ReactNode) => (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-label={type ?? "Task"} role="img" className="shrink-0">
			<rect width="16" height="16" rx="3" fill={fill} />
			{path}
		</svg>
	)
	if (t.includes("bug")) return box("#e5493a", <circle cx="8" cy="8" r="3.5" fill="#fff" />)
	if (t.includes("story")) return box("#63ba3c", <path d="M5 3.5h6v9L8 10l-3 2.5z" fill="#fff" />)
	if (t.includes("epic")) return box("#904ee2", <path d="M9 2.5 4.5 9H8l-1 4.5L11.5 7H8z" fill="#fff" />)
	return box("#4bade8", <path d="m4.5 8.2 2.3 2.3 4.7-4.8" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />)
}

/** Priority, as Jira draws it: red arrows up for high, amber bars for medium, blue arrows down for low. */
export const PriorityIcon = ({ priority }: { priority?: string }) => {
	if (!priority) return null
	const p = priority.toLowerCase()
	const up = p.includes("highest") || p.includes("critical") || p.includes("blocker")
	const high = up || p.includes("high")
	const low = p.includes("low") || p.includes("minor") || p.includes("trivial")
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-label={`Priority: ${priority}`} role="img" className="shrink-0">
			<title>{priority}</title>
			{high ? (
				<path d={up ? "M3 9l5-5 5 5M3 13l5-5 5 5" : "M3 11l5-5 5 5"} stroke="var(--ads-danger)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
			) : low ? (
				<path d="M3 5l5 5 5-5" stroke="#2684ff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
			) : (
				<path d="M3 6h10M3 10h10" stroke="#ffab00" strokeWidth="2" strokeLinecap="round" />
			)}
		</svg>
	)
}

/** Initials in a circle, Jira's fallback avatar. Real avatars are on the customer's Jira site and need its auth. */
export const Avatar = ({ person, size = 24 }: { person?: Person; size?: number }) => {
	const initials = person
		? person.name
				.split(/\s+/)
				.map((w) => w[0])
				.slice(0, 2)
				.join("")
				.toUpperCase()
		: ""
	const hue = person ? [...person.name].reduce((h, c) => h + c.charCodeAt(0), 0) % 6 : 0
	const bg = ["#0055cc", "#216e4e", "#6e5dc6", "#a54800", "#ae2e24", "#206a83"][hue]
	return (
		<span
			className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
			style={{ width: size, height: size, background: person ? bg : "var(--ads-bg-neutral-hovered)" }}
			title={person?.name ?? "Unassigned"}
		>
			{person ? (
				initials
			) : (
				<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
					<circle cx="8" cy="6" r="3" fill="var(--ads-text-subtlest)" />
					<path d="M2.5 14c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" fill="var(--ads-text-subtlest)" />
				</svg>
			)}
		</span>
	)
}

export const Notice = ({ title, tone = "info", children }: { title: string; tone?: "info" | "error"; children?: React.ReactNode }) => (
	<div
		className="rounded-[3px] p-3 text-sm"
		style={{ background: tone === "error" ? "#ffeceb" : "var(--ads-bg-selected)", borderLeft: `3px solid ${tone === "error" ? "var(--ads-danger)" : "var(--ads-bg-brand)"}` }}
	>
		<p className="font-semibold">{title}</p>
		{children && (
			<div className="mt-1" style={{ color: "var(--ads-text-subtle)" }}>
				{children}
			</div>
		)}
	</div>
)

export const Button = ({ kind = "secondary", style, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "subtle" }) => (
	<button
		{...p}
		className={`inline-flex h-8 items-center gap-1 rounded-[3px] px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
			kind === "primary" ? "text-white" : ""
		} ${p.className ?? ""}`}
		style={{
			background: kind === "primary" ? "var(--ads-bg-brand)" : kind === "secondary" ? "var(--ads-bg-neutral)" : "transparent",
			color: kind === "primary" ? "#fff" : kind === "subtle" ? "var(--ads-text-subtle)" : "var(--ads-text)",
			...style
		}}
		onMouseEnter={(e) => {
			if (kind !== "subtle") e.currentTarget.style.background = kind === "primary" ? "var(--ads-bg-brand-hovered)" : "var(--ads-bg-neutral-hovered)"
		}}
		onMouseLeave={(e) => {
			e.currentTarget.style.background = kind === "primary" ? "var(--ads-bg-brand)" : kind === "secondary" ? "var(--ads-bg-neutral)" : "transparent"
		}}
	/>
)

/** Jira's text-field style: 2px border that turns blue on focus. */
export const inputClass = "mt-1 w-full rounded-[3px] border-2 px-2 py-1.5 text-sm outline-none focus:border-[var(--ads-border-focused)] border-[var(--ads-border)] bg-white"

/** One issue, laid out like a Jira list row: type, KEY, summary; then status, priority, due date and assignee. */
export const TaskLine = ({ task }: { task: Task }) => (
	<div className="min-w-0">
		<div className="flex min-w-0 items-center gap-1.5">
			<TypeIcon type={task.type} />
			<a href={task.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium hover:underline" style={{ color: "var(--ads-link)" }}>
				{task.key}
			</a>
			<a href={task.url} target="_blank" rel="noreferrer" className="truncate hover:underline" title={task.title}>
				{task.title}
			</a>
		</div>
		<div className="mt-1.5 flex items-center gap-2">
			<StatusPill category={task.statusCategory} label={task.rawStatus} />
			<PriorityIcon priority={task.priority} />
			{task.dueDate && (
				<span className="text-xs" style={{ color: "var(--ads-text-subtle)" }}>
					Due {task.dueDate}
				</span>
			)}
			<span className="ml-auto">
				<Avatar person={task.assignee} />
			</span>
		</div>
	</div>
)
