"use client";

import {
	Bike,
	BusFront,
	Car,
	CarTaxiFront,
	ChevronDown,
	Crosshair,
	Footprints,
	Leaf,
	LocateFixed,
	MapPin,
	Pencil,
	Radio,
	Search,
	Sparkles,
	X,
	Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	estimateOptions,
	type Mode,
	type RankedOption,
	rankOptions,
	type Weather,
	weatherFactor,
} from "@/lib/plan/options";
import { sliceShape } from "@/lib/plan/paths";
import { type Profile, persona, walkPace } from "@/lib/plan/profile";
import type { TransitRide } from "@/lib/plan/transit";
import { distance } from "@/lib/transit/core";
import { serviceColor } from "@/lib/transit/service-colors";
import type { Position, Stop, TransitRoute } from "@/lib/transit/types";
import { useTransit } from "./use-transit";

type Place = Position & { name: string };
/** What the map draws for the chosen option: walking legs dashed, rides solid. */
export type PlanPath = {
	key: string;
	from: Position;
	to: Position;
	segments: {
		kind: "walk" | "ride";
		color: string;
		coordinates: [number, number][];
	}[];
};
const PATH_COLORS: Record<Mode, string> = {
	walk: "#414454",
	bike: "#1c4b1d",
	scooter: "#ed2891",
	transit: "#414454",
	car: "#6b6b6b",
	taxi: "#7e2324",
};
const PATH_PROFILE: Record<Mode, "foot" | "bike" | "car"> = {
	walk: "foot",
	bike: "bike",
	scooter: "bike",
	transit: "foot",
	car: "car",
	taxi: "car",
};
const pt = (p: Position) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
async function streetPath(
	profile: "foot" | "bike" | "car",
	from: Position,
	to: Position,
	signal: AbortSignal,
) {
	const response = await fetch(
		`/api/path?profile=${profile}&from=${pt(from)}&to=${pt(to)}`,
		{ signal },
	);
	if (!response.ok) throw new Error("No path");
	return ((await response.json()) as { coordinates: [number, number][] })
		.coordinates;
}
type PlanResponse = {
	rides: (TransitRide & {
		fromStop: string;
		toStop: string;
		destination: string;
	})[];
	weather: Weather | null;
	stale: boolean;
	generatedAt: number;
};
const ICONS: Record<Mode, typeof Bike> = {
	walk: Footprints,
	bike: Bike,
	scooter: Zap,
	transit: BusFront,
	car: Car,
	taxi: CarTaxiFront,
};
const time = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Vilnius",
	hour: "2-digit",
	minute: "2-digit",
});
const fold = (s: string) =>
	s.toLocaleLowerCase("lt").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Door-to-door comparison of every way to get there, ranked for the rider's profile. */
export function TripPlanner({
	hidden,
	stops,
	routes,
	origin,
	usingLocation,
	locating,
	onLocate,
	center,
	profile,
	places,
	onPlace,
	onPath,
	onEditProfile,
	now,
}: {
	hidden: boolean;
	stops: Stop[];
	routes: Map<string, TransitRoute>;
	origin: Position;
	usingLocation: boolean;
	locating: boolean;
	onLocate: () => void;
	center: Position;
	profile: Profile;
	places: Place[];
	onPlace: (place: Place) => void;
	onPath: (path: PlanPath | null) => void;
	onEditProfile: () => void;
	now: number;
}) {
	const [query, setQuery] = useState("");
	const [to, setTo] = useState<Place | null>(null);
	// The start is fixed when the destination is chosen, so panning the map to the route
	// doesn't re-plan the trip; a new location fix does.
	const [start, setStart] = useState<Position>(origin);
	const [chosen, setChosen] = useState<string | null>(null);
	function choose(place: Place) {
		setTo(place);
		setStart(origin);
		setChosen(null);
		onPlace(place);
	}
	// biome-ignore lint/correctness/useExhaustiveDependencies: only a new location fix should move the start.
	useEffect(() => {
		if (usingLocation) setStart(origin);
	}, [usingLocation, origin.lat, origin.lon]);
	const [showExcluded, setShowExcluded] = useState(false);
	const suggestions = useMemo(() => {
		const needle = fold(query.trim());
		if (needle.length < 2) return [];
		const seen = new Set<string>();
		return stops
			.filter((s) => fold(s.name).includes(needle))
			.filter((s) => !seen.has(s.name) && seen.add(s.name))
			.slice(0, 6);
	}, [stops, query]);
	const from = {
		lat: Math.round(start.lat * 2000) / 2000,
		lon: Math.round(start.lon * 2000) / 2000,
	};
	const plan = useTransit<PlanResponse>(
		to && !hidden
			? `/api/plan?from=${from.lat},${from.lon}&to=${to.lat.toFixed(5)},${to.lon.toFixed(5)}&pace=${walkPace(profile)}`
			: null,
		60_000,
	);
	const routeName = (id: string) => routes.get(id)?.name ?? "";
	const ranked = useMemo(() => {
		if (!to || !plan.data) return [];
		return rankOptions(
			estimateOptions({
				from: start,
				to,
				now: plan.data.generatedAt,
				rides: plan.data.rides,
				routeName: (id) => routes.get(id)?.name ?? "",
				profile,
			}),
			profile,
			plan.data.weather,
		);
	}, [to, plan.data, profile, start, routes]);
	const usable = ranked.filter((o) => !o.excluded);
	const excluded = ranked.filter((o) => o.excluded);
	const weather = plan.data?.weather ?? null;
	const wf = weatherFactor(weather, profile.weatherSensitive);
	const tooClose = to && distance(start, to) < 150;
	const selected =
		usable.find((o) => o.id === chosen) ?? (tooClose ? undefined : usable[0]);
	const selectedKey = selected
		? `${selected.id}:${pt(start)}:${to ? pt(to) : ""}`
		: "";
	// Draw the chosen option on the map with street paths and the bus route itself.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedKey identifies the option and endpoints.
	useEffect(() => {
		if (hidden || !selected || !to) {
			onPath(null);
			return;
		}
		const controller = new AbortController();
		const { signal } = controller;
		const ride = selected.ride;
		(async () => {
			if (ride) {
				const board = stops.find((s) => s.id === ride.fromStopId);
				const alight = stops.find((s) => s.id === ride.toStopId);
				if (!board || !alight) return;
				const [walkTo, trip, walkFrom] = await Promise.all([
					streetPath("foot", start, board, signal),
					fetch(
						`/api/transit?kind=trip&id=${encodeURIComponent(ride.tripId)}`,
						{
							signal,
						},
					).then(
						(r) => r.json() as Promise<{ coordinates: [number, number][] }>,
					),
					streetPath("foot", alight, to, signal),
				]);
				const route = routes.get(ride.routeId);
				const shape = sliceShape(trip.coordinates ?? [], board, alight);
				onPath({
					key: selectedKey,
					from: start,
					to,
					segments: [
						{ kind: "walk", color: PATH_COLORS.walk, coordinates: walkTo },
						{
							kind: "ride",
							color: serviceColor(route?.name ?? "", route?.mode, route?.color),
							coordinates:
								shape.length > 1
									? shape
									: [
											[board.lon, board.lat],
											[alight.lon, alight.lat],
										],
						},
						{ kind: "walk", color: PATH_COLORS.walk, coordinates: walkFrom },
					],
				});
				return;
			}
			const coordinates = await streetPath(
				PATH_PROFILE[selected.mode],
				start,
				to,
				signal,
			);
			onPath({
				key: selectedKey,
				from: start,
				to,
				segments: [
					{
						kind: selected.mode === "walk" ? "walk" : "ride",
						color: PATH_COLORS[selected.mode],
						coordinates,
					},
				],
			});
		})().catch(() => {});
		return () => controller.abort();
	}, [selectedKey, hidden]);
	return (
		<section className="trip-planner" hidden={hidden} aria-label="Plan a trip">
			<button
				type="button"
				className="profile-chip"
				onClick={onEditProfile}
				aria-label="Edit travel profile"
			>
				<Sparkles size={15} />
				<span>
					Ranked for <strong>{persona(profile)}</strong>
				</span>
				<Pencil size={13} />
			</button>
			<div className="plan-points">
				<div className="plan-point">
					<span className="point-dot from" />
					<span className="point-text">
						<small>From</small>
						{usingLocation ? "My location" : "Map centre"}
					</span>
					<button
						type="button"
						onClick={onLocate}
						disabled={locating}
						aria-label="Use my location"
					>
						<LocateFixed size={16} className={locating ? "spin" : ""} />
					</button>
				</div>
				<div className="plan-point">
					<span className="point-dot to" />
					{to ? (
						<>
							<span className="point-text">
								<small>To</small>
								{to.name}
							</span>
							<button
								type="button"
								onClick={() => {
									setTo(null);
									setQuery("");
									onPath(null);
								}}
								aria-label="Change destination"
							>
								<X size={16} />
							</button>
						</>
					) : (
						<label className="plan-search">
							<Search size={16} />
							<input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Where to? Try a stop name"
								aria-label="Destination"
							/>
						</label>
					)}
				</div>
			</div>
			{!to && places.length > 0 && !query && (
				<div className="recent-places">
					<span>Your places</span>
					<div>
						{places.map((p) => (
							<button type="button" key={p.name} onClick={() => choose(p)}>
								<MapPin size={13} />
								{p.name}
							</button>
						))}
					</div>
				</div>
			)}
			{!to && (
				<div className="plan-suggestions">
					{suggestions.map((s) => (
						<button
							type="button"
							key={s.id}
							onClick={() => choose({ name: s.name, lat: s.lat, lon: s.lon })}
						>
							<MapPin size={15} />
							<span>{s.name}</span>
						</button>
					))}
					<button
						type="button"
						onClick={() => choose({ name: "Pinned on map", ...center })}
					>
						<Crosshair size={15} />
						<span>Use the map centre as destination</span>
					</button>
					<p className="helper-text">
						We compare walking, bikes, scooters, live buses, driving and taxis —
						and rank them for you.
					</p>
				</div>
			)}
			{to && tooClose && (
				<p className="notice">You’re practically there — just walk.</p>
			)}
			{to && !tooClose && !plan.data && !plan.error && (
				<p className="loading-text">Comparing every way to get there…</p>
			)}
			{plan.error && (
				<div className="notice warning">
					Couldn’t check live buses right now.
					<button type="button" onClick={plan.retry}>
						Try again
					</button>
				</div>
			)}
			{to && !tooClose && plan.data && (
				<>
					{wf.reasons.length > 0 && (
						<p className="notice">
							{wf.reasons.join(", ")[0].toUpperCase() +
								wf.reasons.join(", ").slice(1)}{" "}
							— time outdoors counts {Math.round((wf.factor - 1) * 100)}% more
							for you.
						</p>
					)}
					<ol className="plan-options">
						{usable.map((o, i) => (
							<OptionCard
								key={o.id}
								option={o}
								best={i === 0}
								now={now}
								routeColor={
									o.ride
										? serviceColor(
												routeName(o.ride.routeId),
												routes.get(o.ride.routeId)?.mode,
												routes.get(o.ride.routeId)?.color,
											)
										: undefined
								}
								ride={plan.data?.rides.find((r) => r.tripId === o.ride?.tripId)}
								selected={o.id === selected?.id}
								onSelect={() => setChosen(o.id)}
							/>
						))}
					</ol>
					{excluded.length > 0 && (
						<div className="plan-excluded">
							<button
								type="button"
								aria-expanded={showExcluded}
								onClick={() => setShowExcluded(!showExcluded)}
							>
								Not suggested for you ({excluded.length})
								<ChevronDown size={14} />
							</button>
							{showExcluded && (
								<ul>
									{excluded.map((o) => {
										const Icon = ICONS[o.mode];
										return (
											<li key={o.id}>
												<Icon size={15} />
												<strong>{o.label}</strong>
												<span>{o.excluded}</span>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					)}
					<p className="helper-text">
						Bus times are live where vehicles report them. Driving, taxi and
						shared-vehicle times and prices are Vilnius estimates.
					</p>
				</>
			)}
		</section>
	);
}

function OptionCard({
	option: o,
	best,
	now,
	routeColor,
	ride,
	selected,
	onSelect,
}: {
	option: RankedOption;
	best: boolean;
	now: number;
	routeColor?: string;
	ride?: PlanResponse["rides"][number];
	selected: boolean;
	onSelect: () => void;
}) {
	const Icon = ICONS[o.mode];
	const leaveIn = Math.round((o.departAt - now) / 60_000);
	return (
		<li
			className={`plan-option ${best ? "best" : ""} ${selected ? "selected" : ""}`}
		>
			{best && <span className="best-tag">Best for you</span>}
			<div className="plan-option-main">
				<span
					className={`mode-icon mode-${o.mode}`}
					style={routeColor ? { background: routeColor } : undefined}
				>
					<Icon size={20} />
				</span>
				<span className="row-main">
					<strong>
						{o.label}
						{ride && <small> → {ride.destination}</small>}
					</strong>
					<small>
						{ride
							? `${ride.fromStop} → ${ride.toStop} · ${ride.stops} stops`
							: (o.notes[0] ?? "")}
					</small>
				</span>
				<span className="plan-time">
					<strong>
						{o.minutes}
						<small> min</small>
					</strong>
					<small>arrive {time.format(o.arriveAt)}</small>
				</span>
			</div>
			<div className="plan-facts">
				{o.mode === "transit" && !o.estimated && (
					<span className={ride?.live ? "live" : ""}>
						{ride?.live && <Radio size={11} />}
						{leaveIn <= 0 ? "Leave now" : `Leave in ${leaveIn} min`}
					</span>
				)}
				{o.parts.walk > 0 && (
					<span>
						<Footprints size={11} />
						{o.parts.walk} min walk
					</span>
				)}
				{o.parts.wait > 0 && o.mode !== "transit" && (
					<span>{o.parts.wait} min wait</span>
				)}
				<span>{o.cost === 0 ? "Free" : `€${o.cost.toFixed(2)}`}</span>
				<span>
					<Leaf size={11} />
					{o.co2 === 0
						? "0 g CO₂"
						: `${o.co2 >= 1000 ? `${(o.co2 / 1000).toFixed(1)} kg` : `${o.co2} g`} CO₂`}
				</span>
			</div>
			{o.reasons.length > 0 && (
				<ul className="plan-reasons">
					{o.reasons.slice(0, best ? 4 : 2).map((r) => (
						<li key={r}>{r}</li>
					))}
				</ul>
			)}
			<button
				type="button"
				className="option-select"
				aria-pressed={selected}
				onClick={onSelect}
			>
				{selected ? "Shown on the map" : "Show on the map"}
			</button>
		</li>
	);
}
