import type { Metadata } from "next";
import "@fontsource-variable/montserrat";

import "../index.css";

import {
	ConvexAccountProvider,
	LocalAccountProvider,
} from "@/components/account";
import Header from "@/components/header";
import Providers from "@/components/providers";
import { ENV } from "@/env";
import { getAuthServer } from "@/lib/auth-server";

export const metadata: Metadata = {
	title: "MoveSmart",
	description:
		"Live Vilnius transport and personal trip planning: bus, walk, bike or car, ranked for you.",
};

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const auth = getAuthServer();
	const shell = (
		<div className="app-shell">
			<Header />
			{children}
		</div>
	);
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="antialiased">
				{auth && ENV.NEXT_PUBLIC_CONVEX_URL ? (
					<Providers
						initialToken={await auth.getToken()}
						convexUrl={ENV.NEXT_PUBLIC_CONVEX_URL}
					>
						<ConvexAccountProvider>{shell}</ConvexAccountProvider>
					</Providers>
				) : (
					// Without Convex configured, the app runs in guest mode only.
					<LocalAccountProvider>{shell}</LocalAccountProvider>
				)}
			</body>
		</html>
	);
}
