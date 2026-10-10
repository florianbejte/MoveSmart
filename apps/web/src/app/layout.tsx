import type { Metadata } from "next";
import "@fontsource-variable/montserrat";

import "../index.css";

import Header from "@/components/header";

export const metadata: Metadata = {
	title: "MoveSmart",
	description: "Live buses, trolleybuses and nearby stops in Vilnius.",
};

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="antialiased">
				<div className="app-shell">
					<Header />
					{children}
				</div>
			</body>
		</html>
	);
}
