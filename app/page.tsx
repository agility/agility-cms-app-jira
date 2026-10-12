import manifest from "@/public/.well-known/agility-app.json"

/**
 * The page someone sees when they open the deployment directly, e.g. to check it's up. It explains what the app is;
 * the real surfaces only work inside the Agility Manager App.
 */
export default function Page() {
	return (
		<main className="mx-auto max-w-2xl px-6 py-12">
			<div className="flex items-center gap-3">
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src="/icon.svg" alt="" width={40} height={40} className="rounded-lg" />
				<h1 className="text-xl font-semibold text-gray-900">{manifest.name}</h1>
			</div>
			<p className="mt-4 text-gray-700">{manifest.description}</p>
			<p className="mt-4 text-sm text-gray-600">
				This deployment is an Agility CMS app: pages Agility loads in iframes inside the Manager App, plus the backend they
				call. Opening them directly does nothing useful, because they need the handshake the CMS performs.
			</p>
			<h2 className="mt-8 text-sm font-semibold tracking-wide text-gray-500 uppercase">Provides</h2>
			<ul className="mt-2 space-y-1 text-sm text-gray-700">
				<li>
					<span className="font-medium text-gray-900">Content item sidebar</span> — {manifest.capabilities.contentItemSidebar.description}
				</li>
				<li>
					<span className="font-medium text-gray-900">Page sidebar</span> — {manifest.capabilities.pageSidebar.description}
				</li>
			</ul>
		</main>
	)
}
