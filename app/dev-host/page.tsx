import { notFound } from "next/navigation"

import { DevHost } from "@/components/dev-host.client"

/** Local stand-in for the Manager App. Not part of the shipped app. */
export default function Page() {
	if (process.env.NODE_ENV === "production") notFound()
	return <DevHost />
}
