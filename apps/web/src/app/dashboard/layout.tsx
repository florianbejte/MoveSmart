import Link from "next/link";
import Providers from "@/components/providers";
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
			<div className="mx-auto max-w-lg p-10">
				<h1 className="mb-3 font-semibold text-xl">
					Accounts aren’t available yet
				</h1>
				<p className="mb-5">
					You can explore live transport without an account.
				</p>
				<Link className="underline" href="/">
					Back to the live map
				</Link>
			</div>
		);
	const token = await auth.getToken();
	return (
		<Providers initialToken={token} convexUrl={ENV.NEXT_PUBLIC_CONVEX_URL}>
			{children}
		</Providers>
	);
}
