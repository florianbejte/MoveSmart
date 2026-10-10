import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

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
				<div className="grid h-svh grid-rows-[auto_1fr]">
					<Header />
					{children}
				</div>
			</body>
		</html>
	);
}
