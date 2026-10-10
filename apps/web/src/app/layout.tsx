import type { Metadata } from "next";
import { LanguageSetup } from "@/lib/i18n/react";
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
		"Vilniaus transportas realiuoju laiku ir kelionių planavimas pagal jūsų poreikius.",
};

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const auth = getAuthServer();
	const shell = (
		<div className="app-shell">
			<LanguageSetup />
			<Header />
			{children}
		</div>
	);
	return (
		<html lang="lt" suppressHydrationWarning>
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
