"use client";

import { Leaf, Pencil, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { kg, weightsFor } from "@/lib/plan/options";
import { NEEDS, PRIORITIES, persona } from "@/lib/plan/profile";
import { useAccount } from "./account";
import { Onboarding } from "./transit/onboarding";
import "./transit/transit.css";

/** The saved questionnaire answers on the account page, with a way to change them. */
export function TravelProfileCard() {
	const account = useAccount();
	const [editing, setEditing] = useState(false);
	const p = account.profile;
	if (p === undefined) return <p role="status">Loading your travel profile…</p>;
	const rows: [string, string][] = p
		? [
				[
					"Travelling",
					p.needs.length
						? NEEDS.filter((n) => p.needs.includes(n.id))
								.map((n) => n.label)
								.join(", ")
						: "Just me",
				],
				[
					"Can use",
					[
						p.hasCar && "car",
						p.hasBike && "own bike",
						p.sharedOk && "shared bikes & scooters",
						p.hasPass && "transit pass",
					]
						.filter(Boolean)
						.join(", ") || "walking and public transport",
				],
				[
					"Matters most",
					PRIORITIES.filter((x) => p.priorities.includes(x.id))
						.map((x) => x.label)
						.join(", "),
				],
				["Walks up to", `${p.walkLimit === 25 ? "20+" : p.walkLimit} min`],
				[
					"Weather",
					p.weatherSensitive ? "Changes my plans" : "Doesn’t bother me",
				],
			]
		: [];
	return (
		<section className="travel-profile" aria-labelledby="travel-profile-title">
			<div className="travel-profile-heading">
				<Sparkles size={18} />
				<div>
					<small>Your travel profile</small>
					<h2 id="travel-profile-title">{p ? persona(p) : "Not set up yet"}</h2>
				</div>
			</div>
			<p className="impact-banner">
				<Leaf size={15} />
				<span>
					{account.impact.trips > 0 ? (
						<>
							You’ve saved <strong>{kg(account.impact.grams)} CO₂</strong> in{" "}
							{account.impact.trips} green trip
							{account.impact.trips === 1 ? "" : "s"}.
						</>
					) : (
						"Your CO₂ savings appear here after your first green trip."
					)}
				</span>
			</p>
			{p ? (
				<dl>
					{rows.map(([label, value]) => (
						<div key={label}>
							<dt>{label}</dt>
							<dd>{value}</dd>
						</div>
					))}
				</dl>
			) : (
				<p>Answer five quick questions so we can rank trips for you.</p>
			)}
			{p && (
				<div className="profile-formula">
					<small>Your personal route formula</small>
					<p>
						C(r) = T<sub>ride</sub> + <b>{weightsFor(p, null).alpha}</b>·m(W)·T
						<sub>walk</sub> + <b>{weightsFor(p, null).beta}</b>·T<sub>wait</sub>{" "}
						+ <b>{weightsFor(p, null).gamma}</b>·N<sub>transfers</sub> +{" "}
						<b>{weightsFor(p, null).delta}</b>·Q<sub>crowding</sub> +{" "}
						<b>{weightsFor(p, null).eta}</b>·D<sub>delay</sub>
					</p>
					<small>
						Walking, waiting, changes, crowding and delays weighted by your
						answers. Change an answer and every trip re-ranks.
					</small>
				</div>
			)}
			<button
				type="button"
				className="travel-profile-edit"
				onClick={() => setEditing(true)}
			>
				<Pencil size={15} />
				{p ? "Edit answers" : "Answer the questions"}
			</button>
			{editing && (
				<Onboarding
					initial={p}
					doneLabel="Save changes"
					onSkip={() => setEditing(false)}
					onDone={async (next) => {
						setEditing(false);
						try {
							await account.saveProfile(next);
							toast.success("Travel profile updated.");
						} catch {
							toast.error("Couldn’t save your travel profile. Try again.");
						}
					}}
				/>
			)}
		</section>
	);
}
