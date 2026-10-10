import AccountUnavailable from "@/components/account-unavailable";
import { ENV } from "@/env";
import { getAuthServer } from "@/lib/auth-server";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const auth = getAuthServer();
	if (!auth || !ENV.NEXT_PUBLIC_CONVEX_URL) return <AccountUnavailable />;
	// Providers are set up in the root layout.
	return children;
}
