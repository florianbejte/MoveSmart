"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { TravelProfileCard } from "@/components/travel-profile-card";
import UserMenu from "@/components/user-menu";
import { useT } from "@/lib/i18n/react";

function DashboardContent() {
	const t = useT();

	return (
		<section className="account-panel">
			<span className="account-symbol">
				<UserRound size={30} />
			</span>
			<h1>{t("Your account.")}</h1>
			<p>
				{t(
					"You’re signed in. Your travel profile ranks every trip you plan. Use the account menu to sign out.",
				)}
			</p>
			<UserMenu />
			<TravelProfileCard />
			<Link href="/" className="account-link">
				{t("Plan a trip")}
			</Link>
		</section>
	);
}

export default function DashboardPage() {
	const t = useT();

	const [showSignIn, setShowSignIn] = useState(false);
	// The welcome screen links here with ?mode=signin for returning users.
	useEffect(() => {
		setShowSignIn(
			new URLSearchParams(window.location.search).get("mode") === "signin",
		);
	}, []);

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
				<p role="status">{t("Loading your account…")}</p>
			</AuthLoading>
		</main>
	);
}
