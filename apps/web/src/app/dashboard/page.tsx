"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import UserMenu from "@/components/user-menu";

function DashboardContent() {
	return (
		<section className="account-panel">
			<span className="account-symbol">
				<UserRound size={30} />
			</span>
			<h1>Your account.</h1>
			<p>
				You’re signed in. Explore Vilnius or use the account menu to sign out.
			</p>
			<UserMenu />
			<Link href="/" className="account-link">
				Explore the live map
			</Link>
		</section>
	);
}

export default function DashboardPage() {
	const [showSignIn, setShowSignIn] = useState(false);

	return (
		<main className="account-page">
			<Authenticated>
				<DashboardContent />
			</Authenticated>
			<Unauthenticated>
				{showSignIn ? (
					<SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
				) : (
					<SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
				)}
			</Unauthenticated>
			<AuthLoading>
				<p role="status">Loading your account…</p>
			</AuthLoading>
		</main>
	);
}
