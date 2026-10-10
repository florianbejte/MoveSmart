"use client";

import { ArrowRight, Route, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/react";

/** First screen for visitors who aren't signed in: create an account, sign in, or look around. */
export function Welcome({ onGuest }: { onGuest: () => void }) {
	const t = useT();

	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		dialog.current?.showModal();
	}, []);
	return (
		<dialog
			ref={dialog}
			className="onboarding welcome"
			aria-labelledby="welcome-title"
			onCancel={(e) => {
				e.preventDefault();
				onGuest();
			}}
		>
			<section>
				<span className="flow-eyebrow">{t("MOVE SMART · VILNIUS")}</span>
				<h2 id="welcome-title">{t("Your way around Vilnius.")}</h2>
				<p>
					{t(
						"Find your next bus, compare ways to get there, and see what’s happening nearby.",
					)}
				</p>
				<ul className="welcome-points">
					<li>
						<Sparkles size={16} />
						{t("Ranked for your needs: strollers, wheelchairs, kids, luggage")}
					</li>
					<li>
						<Route size={16} />
						{t("Live bus times, weather and real walking paths")}
					</li>
					<li>
						<UserRound size={16} />
						{t("Save your travel preferences for next time")}
					</li>
				</ul>
			</section>
			<div className="welcome-actions">
				<button type="button" className="onboarding-next" onClick={onGuest}>
					{t("Explore the map")}
					<ArrowRight size={16} />
				</button>
				<Link className="welcome-signin" href="/dashboard?mode=signin">
					{t("I already have an account")}
				</Link>
				<Link className="onboarding-back" href="/dashboard">
					{t("Create an account")}
				</Link>
			</div>
		</dialog>
	);
}
