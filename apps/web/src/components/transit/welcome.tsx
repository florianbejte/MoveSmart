"use client";

import { ArrowRight, Route, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

/** First screen for visitors who aren't signed in: create an account, sign in, or look around. */
export function Welcome({ onGuest }: { onGuest: () => void }) {
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
				<span className="bubble-tag lime">COMFY</span>{" "}
				<span className="bubble-tag navy">NEXT</span>
				<h2 id="welcome-title">Your way around Vilnius.</h2>
				<p>
					Tell us how you travel once. Then just say where you’re going — we
					compare live buses, walking, bikes, scooters and the car, and show the
					best way for you on the map.
				</p>
				<ul className="welcome-points">
					<li>
						<Sparkles size={16} />
						Ranked for your needs: strollers, wheelchairs, kids, luggage
					</li>
					<li>
						<Route size={16} />
						Live bus times, weather and real walking paths
					</li>
					<li>
						<UserRound size={16} />
						Your profile and favourite places follow your account
					</li>
				</ul>
			</section>
			<div className="welcome-actions">
				<Link className="onboarding-next" href="/dashboard">
					Create an account
					<ArrowRight size={16} />
				</Link>
				<Link className="welcome-signin" href="/dashboard?mode=signin">
					I already have an account
				</Link>
				<button type="button" className="onboarding-back" onClick={onGuest}>
					Continue as a guest
				</button>
			</div>
		</dialog>
	);
}
