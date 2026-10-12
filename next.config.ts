import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	/** The dev indicator floats over the bottom-left of every iframe, where the panel's own controls are. */
	devIndicators: false,

	/**
	 * Agility loads these pages as cross-origin iframes inside the Manager App, so nothing here may send
	 * X-Frame-Options or a frame-ancestors CSP. Next sets neither by default; the note is here so it stays that way.
	 */
	async headers() {
		return [
			{
				source: "/.well-known/agility-app.json",
				headers: [
					{ key: "Cache-Control", value: "public, max-age=300" },
					{ key: "Access-Control-Allow-Origin", value: "*" }
				]
			}
		]
	}
}

export default nextConfig
