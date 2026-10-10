import { BusFront } from "lucide-react";
import Link from "next/link";
import { ENV } from "@/env";
import { getAuthServer } from "@/lib/auth-server";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const auth = getAuthServer();
	if (!auth || !ENV.NEXT_PUBLIC_CONVEX_URL)
		return (
			<main className="account-page">
				<section className="account-panel">
					<span className="account-symbol">
						<BusFront size={30} />
					</span>
					<h1>Accounts aren’t available yet</h1>
					<p>You can explore live transport without an account.</p>
					<Link className="account-link" href="/">
						Back to the live map
					</Link>
				</section>
			</main>
		);
	// Providers are set up in the root layout.
	return children;
}
