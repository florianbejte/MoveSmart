"use client";

import { Toaster } from "@MoveSmart/ui/components/sonner";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

import { ThemeProvider } from "./theme-provider";

export default function Providers({
	children,
	initialToken,
	convexUrl,
}: {
	children: React.ReactNode;
	convexUrl: string;
	initialToken?: string | null;
}) {
	const [convex] = useState(() => new ConvexReactClient(convexUrl));
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
		>
			<ConvexBetterAuthProvider
				client={convex}
				authClient={authClient}
				initialToken={initialToken}
			>
				{children}
			</ConvexBetterAuthProvider>
			<Toaster richColors />
		</ThemeProvider>
	);
}
