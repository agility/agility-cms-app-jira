import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
	title: "Jira Issues for Agility CMS",
	description: "Link Agility content to Jira issues, create issues from content, and see their status in the editor.",
	robots: { index: false, follow: false }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
