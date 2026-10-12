import { NextResponse, type NextRequest } from "next/server"

/** The mock provider's "consent screen": straight back to the callback with a code. WORK_PROVIDER=mock only. */
export async function GET(req: NextRequest) {
	if (process.env.WORK_PROVIDER !== "mock") return new Response("Not found", { status: 404 })
	const back = new URL(req.nextUrl.searchParams.get("redirect_uri") ?? "/api/connect/callback", req.nextUrl.origin)
	back.searchParams.set("code", "mock-code")
	back.searchParams.set("state", req.nextUrl.searchParams.get("state") ?? "")
	return NextResponse.redirect(back)
}
