"use client";

import { api } from "@MoveSmart/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { BusFront, Clock3, Crosshair, MapPin, Navigation } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/react";
import { companionStep } from "@/lib/plan/companion";
import type { LiveFeed } from "@/lib/transit/types";
import { useTransit } from "../transit/use-transit";
import "./shared-trip.css";

const SharedTripMap = dynamic(() => import("./shared-trip-map"), {
	ssr: false,
	loading: () => <MapLoading />,
});
function MapLoading() {
	const t = useT();
	return (
		<div className="shared-map shared-map-loading">{t("Loading map…")}</div>
	);
}
const time = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Vilnius",
	hour: "2-digit",
	minute: "2-digit",
});
const ago = (ms: number) => {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};

/** The page a friend opens: where the traveller is now, their bus, the route and the ETA. */
export function SharedTripView({ shareId }: { shareId: string }) {
	const t = useT();
	const trip = useQuery(api.sharedTrips.get, { shareId });
	const live = useTransit<LiveFeed>("/api/transit?kind=vehicles", 10_000);
	const [now, setNow] = useState(Date.now());
	const [follow, setFollow] = useState(true);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 5_000);
		return () => clearInterval(timer);
	}, []);
	const vehicles = live.data?.vehicles ?? [];
	const delays = useMemo(
		() => new Map(vehicles.map((v) => [v.tripId, v.delay])),
		[vehicles],
	);
	if (trip === undefined)
		return (
			<main className="shared-trip-page">
				<p className="shared-loading">{t("Loading the trip…")}</p>
			</main>
		);
	if (trip === null)
		return (
			<main className="shared-trip-page">
				<section className="shared-card">
					<h1>{t("This trip link doesn’t exist")}</h1>
					<p>{t("It may have been mistyped. Ask for a new link.")}</p>
					<Link href="/" className="shared-cta">
						{t("Open MoveSmart")}
					</Link>
				</section>
			</main>
		);
	const name = trip.name ?? t("Your friend");
	const ended = trip.status !== "active" || trip.expiresAt < now;
	const legs = trip.legs;
	// The ETA follows the last bus's live delay; the walk at the end stays the same.
	const last = legs.at(-1);
	const lastDelay = last ? (delays.get(last.tripId) ?? null) : null;
	const eta =
		trip.arriveAt +
		(last && lastDelay !== null
			? (lastDelay - (last.delaySeconds ?? 0)) * 1000
			: 0);
	const step = legs.length
		? companionStep(
				legs.map((l) => ({
					...l,
					walkToMetres: 0,
					walkFromMetres: 0,
					stops: 0,
					live: false,
					fromStopId: "",
					toStopId: "",
				})),
				now,
				(id) => delays.get(id) ?? null,
				Math.max(
					0,
					Math.round((legs[0].departAt - trip.departAt) / 60_000) - 1,
				),
			)
		: null;
	const leg = (key: string) => legs[Number(key.split("-")[1])] ?? legs[0];
	const status = ended
		? trip.status === "arrived"
			? `${name} has arrived`
			: `${name} stopped sharing`
		: !step
			? now < eta
				? `${name} is on the way · ${trip.label}`
				: `${name} should have arrived`
			: step.key === "wait"
				? `${name} is getting ready to leave`
				: step.key === "walk"
					? `${name} is walking to ${legs[0].fromStop}`
					: step.key.startsWith("board")
						? `${name} is waiting for bus ${leg(step.key).route} at ${leg(step.key).fromStop}`
						: step.key.startsWith("ride")
							? `${name} is on bus ${leg(step.key).route}`
							: step.key.startsWith("exit")
								? `${name} is getting off at ${leg(step.key).toStop}`
								: step.key.startsWith("change")
									? `${name} is changing to bus ${legs[Number(step.key.split("-")[1]) + 1]?.route}`
									: `${name} is almost there`;
	const tripIds = new Set(legs.map((l) => l.tripId));
	const own = vehicles.filter((v) => v.tripId && tripIds.has(v.tripId));
	const buses = ended
		? []
		: own.length
			? own
			: vehicles
					.filter((v) => legs.some((l) => l.routeId === v.routeId))
					.slice(0, 6);
	const position = !ended && trip.position ? trip.position : null;
	const stale = position ? now - position.at > 120_000 : false;
	return (
		<main className="shared-trip-page">
			<section className="shared-card">
				<span className="shared-eyebrow">
					<span className={`live-dot ${ended ? "off" : ""}`} />
					{t(ended ? "Trip sharing ended" : "Live trip")}
				</span>
				<h1>{t(status)}</h1>
				<p className="shared-route">
					<MapPin size={14} /> {trip.from.name} →{" "}
					<strong>{trip.to.name}</strong>
				</p>
				<div className="shared-facts">
					<div>
						<small>{t("Arrives")}</small>
						<strong>
							{ended && trip.status === "arrived"
								? t("Arrived")
								: time.format(eta)}
						</strong>
						{!ended && lastDelay !== null && Math.abs(lastDelay) >= 60 && (
							<small>
								{t(
									`bus ${Math.round(Math.abs(lastDelay) / 60)} min ${lastDelay > 0 ? "late" : "early"}`,
								)}
							</small>
						)}
					</div>
					<div>
						<small>{t("Travelling by")}</small>
						<strong>{t(trip.label)}</strong>
					</div>
				</div>
				{legs.length > 0 && (
					<ol className="shared-legs">
						{legs.map((l) => {
							const d = delays.get(l.tripId);
							const shift =
								d !== undefined && d !== null
									? (d - (l.delaySeconds ?? 0)) * 1000
									: 0;
							return (
								<li key={`${l.tripId}-${l.fromStop}`}>
									<span className="shared-badge">
										<BusFront size={13} /> {l.route}
									</span>
									<span>
										{l.fromStop} {time.format(l.departAt + shift)} → {l.toStop}{" "}
										{time.format(l.arriveAt + shift)}
										{d !== undefined && d !== null && <em> · {t("live")}</em>}
									</span>
								</li>
							);
						})}
					</ol>
				)}
				{!ended && (
					<p className="shared-updated">
						<Clock3 size={13} />
						{position
							? `${t(`Location updated ${ago(now - position.at)}`)}${stale ? ` — ${t("signal may be lost")}` : ""}`
							: t(
									"Live location not shared yet — showing the planned route and the bus.",
								)}
					</p>
				)}
				{!ended && position && (
					<button
						type="button"
						className="shared-follow"
						aria-pressed={follow}
						onClick={() => setFollow(!follow)}
					>
						<Crosshair size={14} />
						{t(follow ? `Following ${name}` : `Follow ${name}`)}
					</button>
				)}
				<Link href="/" className="shared-cta">
					<Navigation size={14} /> {t("Plan your own trip with MoveSmart")}
				</Link>
			</section>
			<SharedTripMap
				path={trip.path}
				from={trip.from}
				to={trip.to}
				position={position}
				buses={buses}
				follow={follow}
			/>
		</main>
	);
}
