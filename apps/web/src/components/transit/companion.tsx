"use client";

import { Bell, BellRing, Navigation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/react";
import { type CompanionLeg, companionStep } from "@/lib/plan/companion";
import type { Vehicle } from "@/lib/transit/types";

/**
 * Live trip companion: what to do now, following the chosen buses' live delays, with
 * browser notifications for the moments that matter while this page is open.
 */
export function TripCompanion({
	legs,
	walkMinutes,
	vehicles,
	now,
}: {
	legs: CompanionLeg[];
	walkMinutes: number;
	vehicles: Vehicle[];
	now: number;
}) {
	const t = useT();
	// The explorer ticks every 10 s; tick faster here so countdowns stay accurate.
	const [clock, setClock] = useState(now);
	useEffect(() => {
		const timer = setInterval(() => setClock(Date.now()), 5_000);
		return () => clearInterval(timer);
	}, []);
	const at = Math.max(now, clock);
	const delays = new Map(vehicles.map((v) => [v.tripId, v.delay]));
	const step = companionStep(
		legs,
		at,
		(tripId) => delays.get(tripId) ?? null,
		walkMinutes,
	);
	const [notify, setNotify] = useState(false);
	const fired = useRef(new Set<string>());
	useEffect(() => {
		if (!notify || !step.notify || fired.current.has(step.key)) return;
		fired.current.add(step.key);
		try {
			new Notification(t(step.title), {
				body: t(step.detail),
				tag: "movesmart-trip",
			});
		} catch {
			// Some mobile browsers only allow notifications from a service worker.
		}
	}, [notify, step, t]);
	const supported = typeof window !== "undefined" && "Notification" in window;
	return (
		<section className={`companion ${step.tone}`} aria-live="polite">
			<span className="companion-icon">
				<Navigation size={18} />
			</span>
			<div>
				<small>{t("Your trip, live")}</small>
				<strong>{t(step.title)}</strong>
				<p>{t(step.detail)}</p>
			</div>
			{supported && (
				<button
					type="button"
					aria-pressed={notify}
					onClick={async () => {
						if (notify) return setNotify(false);
						const permission =
							Notification.permission === "granted"
								? "granted"
								: await Notification.requestPermission();
						setNotify(permission === "granted");
					}}
					aria-label={t(
						notify ? "Turn off trip alerts" : "Alert me on this trip",
					)}
					title={t(
						notify ? "Trip alerts on" : "Alert me: leave, bus coming, get off",
					)}
				>
					{notify ? <BellRing size={17} /> : <Bell size={17} />}
				</button>
			)}
		</section>
	);
}
