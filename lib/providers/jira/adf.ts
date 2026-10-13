/**
 * Plain text → Atlassian Document Format. Jira Cloud's v3 API takes descriptions only as ADF, and a plain string is
 * rejected with a 400. Paragraphs come from blank-line breaks, line breaks inside one become hardBreaks, and bare
 * URLs become links so the "open in Agility" line in a created issue is clickable.
 */

type Mark = { type: "link"; attrs: { href: string } }
type Inline = { type: "text"; text: string; marks?: Mark[] } | { type: "hardBreak" }
interface Paragraph {
	type: "paragraph"
	content: Inline[]
}
export interface AdfDoc {
	type: "doc"
	version: 1
	content: Paragraph[]
}

const URL_RE = /(https?:\/\/[^\s<>"]+)/g

const inlines = (line: string): Inline[] => {
	const out: Inline[] = []
	let last = 0
	for (const m of line.matchAll(URL_RE)) {
		const at = m.index ?? 0
		if (at > last) out.push({ type: "text", text: line.slice(last, at) })
		out.push({ type: "text", text: m[1], marks: [{ type: "link", attrs: { href: m[1] } }] })
		last = at + m[1].length
	}
	if (last < line.length) out.push({ type: "text", text: line.slice(last) })
	return out
}

export const toAdf = (text: string): AdfDoc => {
	const paragraphs = text
		.replace(/\r\n/g, "\n")
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p): Paragraph => {
			const content: Inline[] = []
			p.split("\n").forEach((line, i) => {
				if (i > 0) content.push({ type: "hardBreak" })
				content.push(...inlines(line))
			})
			return { type: "paragraph", content }
		})
	return { type: "doc", version: 1, content: paragraphs.length ? paragraphs : [{ type: "paragraph", content: [] }] }
}
