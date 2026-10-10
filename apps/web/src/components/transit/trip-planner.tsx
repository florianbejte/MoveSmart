"use client";

import {
	ArrowLeft,
	ArrowRight,
	Bike,
	BusFront,
	Car,
	CarTaxiFront,
	ChevronDown,
	ExternalLink,
	Footprints,
	KeyRound,
	Leaf,
	LocateFixed,
	MapPin,
	Navigation,
	Pencil,
	Radio,
	Search,
	Sparkles,
	X,
	Zap,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { GeocodeHit } from "@/lib/plan/geocode";
import {
	estimateOptions,
	kg,
	type Mode,
	type RankedOption,
	rankOptions,
	type Weather,
	weatherFactor,
} from "@/lib/plan/options";
import { sliceShape } from "@/lib/plan/paths";
import { type Profile, persona, walkPace } from "@/lib/plan/profile";
import { bookingLink, type Quote } from "@/lib/plan/providers";
import type { TransitRide } from "@/lib/plan/transit";
import { distance } from "@/lib/transit/core";
import { serviceColor } from "@/lib/transit/service-colors";
import type { Position, Stop, TransitRoute } from "@/lib/transit/types";
import { useAccount } from "../account";
import { useTransit } from "./use-transit";

type Place = Position & { name: string };
/** What the map draws for the chosen option: walking legs dashed, rides solid. */
export type PlanPath = {
	key: string;
	from: Position;
	to: Position;
	/** The buses being taken, so the map can show only those. */
	rides?: { routeId: string; tripId: string }[];
	stopIds?: string[];
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
	carshare: "#3d9a3a",
};
const PATH_PROFILE: Record<Mode, "foot" | "bike" | "car"> = {
	walk: "foot",
	bike: "bike",
	scooter: "bike",
	transit: "foot",
	car: "car",
	taxi: "car",
	carshare: "car",
};
const legKey = (r: TransitRide) => `${r.tripId}:${r.fromStopId}:${r.toStopId}`;
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
type NamedRide = TransitRide & {
	fromStop: string;
	toStop: string;
	destination: string;
};
type PlanResponse = {
	rides: NamedRide[];
	transfers?: { legs: [NamedRide, NamedRide] }[];
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
	carshare: KeyRound,
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
	profile,
	places,
	onPlace,
	onPath,
	onStage,
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
	profile: Profile;
	places: Place[];
	onPlace: (place: Place) => void;
	onPath: (path: PlanPath | null) => void;
	/** "choose": destination and options, no map. "map": the chosen way, shown on the map. */
	onStage: (stage: "choose" | "map") => void;
	onEditProfile: () => void;
	now: number;
}) {
	const account = useAccount();
	const [query, setQuery] = useState("");
	const [to, setTo] = useState<Place | null>(null);
	// The start is fixed when the destination is chosen, so panning the map to the route
	// doesn't re-plan the trip; a new location fix does.
	const [start, setStart] = useState<Position>(origin);
	// The option the rider decided to go with; only then does the map open.
	const [going, setGoing] = useState<string | null>(null);
	function choose(place: Place) {
		setTo(place);
		setStart(origin);
		setGoing(null);
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
			.slice(0, 3);
	}, [stops, query]);
	// Addresses and places, looked up after a short pause in typing.
	const [lookup, setLookup] = useState<{
		query: string;
		hits: GeocodeHit[];
		error?: boolean;
	}>({ query: "", hits: [] });
	useEffect(() => {
		const q = query.trim();
		if (q.length < 3) return;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const response = await fetch(
					`/api/geocode?q=${encodeURIComponent(q)}`,
					{ signal: controller.signal },
				);
				if (!response.ok) throw new Error("Geocoding failed");
				const { hits } = (await response.json()) as { hits: GeocodeHit[] };
				setLookup({ query: q, hits });
			} catch {
				if (!controller.signal.aborted)
					setLookup({ query: q, hits: [], error: true });
			}
		}, 300);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query]);
	const searching = query.trim().length >= 3 && lookup.query !== query.trim();
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
				transfers: plan.data.transfers,
				routeName: (id) => routes.get(id)?.name ?? "",
				profile,
			}),
			profile,
			plan.data.weather,
		);
	}, [to, plan.data, profile, start, routes]);
	const usable = ranked.filter((o) => !o.excluded);
	// Stop names and headsigns from the server, for every bus in every option.
	const named = new Map<string, NamedRide>();
	for (const r of [
		...(plan.data?.rides ?? []),
		...(plan.data?.transfers ?? []).flatMap((t) => t.legs),
	])
		named.set(legKey(r), r);
	const excluded = ranked.filter((o) => o.excluded);
	const weather = plan.data?.weather ?? null;
	const wf = weatherFactor(weather, profile.weatherSensitive);
	const tooClose = to && distance(start, to) < 150;
	const selected = usable.find((o) => o.id === going);
	const stage = selected && !hidden ? "map" : "choose";
	// biome-ignore lint/correctness/useExhaustiveDependencies: onStage is a stable state setter.
	useEffect(() => onStage(stage), [stage]);
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
		const legs = selected.legs;
		(async () => {
			if (legs?.length) {
				const stop = (id: string) => stops.find((s) => s.id === id);
				const ends = legs.map((l) => [stop(l.fromStopId), stop(l.toStopId)]);
				if (ends.some(([a, b]) => !a || !b)) return;
				const shapes = await Promise.all(
					legs.map((l) =>
						fetch(`/api/transit?kind=trip&id=${encodeURIComponent(l.tripId)}`, {
							signal,
						}).then(
							(r) => r.json() as Promise<{ coordinates: [number, number][] }>,
						),
					),
				);
				// Walks: to the first stop, between stops when changing, and to the destination.
				const walkPoints: [Position, Position][] = [
					[start, ends[0][0] as Stop],
					...legs
						.slice(1)
						.map(
							(_leg, i) =>
								[ends[i][1] as Stop, ends[i + 1][0] as Stop] as [
									Position,
									Position,
								],
						),
					[ends[legs.length - 1][1] as Stop, to],
				];
				const walks = await Promise.all(
					walkPoints.map(([a, b]) =>
						distance(a, b) < 15
							? Promise.resolve([] as [number, number][])
							: streetPath("foot", a, b, signal),
					),
				);
				const segments: PlanPath["segments"] = [];
				legs.forEach((l, i) => {
					const [board, alight] = ends[i] as [Stop, Stop];
					const route = routes.get(l.routeId);
					const shape = sliceShape(shapes[i].coordinates ?? [], board, alight);
					segments.push(
						{ kind: "walk", color: PATH_COLORS.walk, coordinates: walks[i] },
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
					);
				});
				segments.push({
					kind: "walk",
					color: PATH_COLORS.walk,
					coordinates: walks[legs.length],
				});
				onPath({
					key: selectedKey,
					from: start,
					to,
					rides: legs.map(({ routeId, tripId }) => ({ routeId, tripId })),
					stopIds: legs.flatMap((l) => [l.fromStopId, l.toStopId]),
					segments,
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
			<p className="impact-banner">
				<Leaf size={15} />
				{account.impact.trips > 0 ? (
					<span>
						You’ve saved <strong>{kg(account.impact.grams)} CO₂</strong> in{" "}
						{account.impact.trips} green trip
						{account.impact.trips === 1 ? "" : "s"}
					</span>
				) : (
					<span>
						Every bus, walk or bike trip instead of a car saves CO₂ — we’ll
						count yours.
					</span>
				)}
			</p>
			<div className="plan-points">
				<div className="plan-point">
					<span className="point-dot from" />
					<span className="point-text">
						<small>From</small>
						{usingLocation
							? "My location"
							: "City centre · tap ⌖ for your location"}
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
									setGoing(null);
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
								placeholder="Where to? Address, place or stop"
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
					{query.trim().length >= 3 &&
						lookup.query === query.trim() &&
						lookup.hits.map((h) => (
							<button
								type="button"
								key={`${h.name}-${h.lat}-${h.lon}`}
								onClick={() => choose({ name: h.name, lat: h.lat, lon: h.lon })}
							>
								<Navigation size={15} />
								<span className="suggestion-text">
									<span>{h.name}</span>
									<small>
										{[h.detail, h.kind].filter(Boolean).join(" · ")}
									</small>
								</span>
							</button>
						))}
					{searching && (
						<p className="loading-text">Searching addresses and places…</p>
					)}
					{lookup.error && lookup.query === query.trim() && (
						<p className="helper-text">
							Address search is unavailable right now — stops still work.
						</p>
					)}
					{suggestions.map((s) => (
						<button
							type="button"
							key={s.id}
							onClick={() => choose({ name: s.name, lat: s.lat, lon: s.lon })}
						>
							<BusFront size={15} />
							<span className="suggestion-text">
								<span>{s.name}</span>
								<small>Stop</small>
							</span>
						</button>
					))}
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
					{selected && (
						<button
							type="button"
							className="back-to-options"
							onClick={() => setGoing(null)}
						>
							<ArrowLeft size={15} />
							All options
						</button>
					)}
					<ol className="plan-options">
						{(selected ? [selected] : usable).map((o, i) => (
							<OptionCard
								key={o.id}
								option={o}
								best={i === 0 && !selected}
								now={now}
								routeColor={
									o.ride && (o.legs?.length ?? 1) === 1
										? serviceColor(
												routeName(o.ride.routeId),
												routes.get(o.ride.routeId)?.mode,
												routes.get(o.ride.routeId)?.color,
											)
										: undefined
								}
								legs={o.legs?.map(
									(l) =>
										named.get(legKey(l)) ?? {
											...l,
											fromStop: "",
											toStop: "",
											destination: "",
										},
								)}
								routes={routes}
								going={o.id === selected?.id}
								onGo={() => {
									setGoing(o.id);
									if (o.green) account.logGreenTrip(o.mode, o.co2Saved);
								}}
								trip={{ from: start, to }}
							/>
						))}
					</ol>
					{excluded.length > 0 && !selected && (
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
	legs,
	routes,
	going,
	onGo,
	trip,
}: {
	option: RankedOption;
	best: boolean;
	now: number;
	routeColor?: string;
	legs?: NamedRide[];
	routes: Map<string, TransitRoute>;
	going: boolean;
	onGo: () => void;
	trip: { from: Position; to: Place };
}) {
	const Icon = ICONS[o.mode];
	const ride = legs?.[0];
	const change = legs && legs.length > 1 ? legs[1] : undefined;
	const leaveIn = Math.round((o.departAt - now) / 60_000);
	const top = o.quotes?.find((q) => q.price !== null);
	return (
		<li className={`plan-option ${best ? "best" : ""} ${going ? "going" : ""}`}>
			{best && (
				<span className={`best-tag ${o.green ? "green" : ""}`}>
					{o.promoted === "greener"
						? "Greener way"
						: o.green
							? "Best for you & Vilnius"
							: "Best for you"}
				</span>
			)}
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
						{ride && !change && <small> → {ride.destination}</small>}
					</strong>
					<small>
						{change
							? `Change at ${legs?.[0].toStop}`
							: ride
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
				<span>
					{o.cost === 0
						? "Free"
						: `${o.quotes ? "from " : ""}€${(top?.price ?? o.cost).toFixed(2)}`}
				</span>
				{o.green && o.co2Saved >= 50 ? (
					<span className="co2-good">
						<Leaf size={11} />
						Saves {kg(o.co2Saved)} CO₂
					</span>
				) : (
					<span
						className={
							["car", "taxi", "carshare"].includes(o.mode) && o.co2 > 0
								? "co2-bad"
								: ""
						}
					>
						<Leaf size={11} />
						{kg(o.co2)} CO₂
					</span>
				)}
			</div>
			{legs && legs.length > 0 && <Itinerary legs={legs} routes={routes} />}
			{o.reasons.length > 0 && (
				<ul className="plan-reasons">
					{o.reasons.slice(0, best || going ? 4 : 2).map((r) => (
						<li key={r}>{r}</li>
					))}
				</ul>
			)}
			{going && o.green && o.co2Saved >= 50 && (
				<p className="impact-thanks">
					<Leaf size={15} />
					Nice choice — this trip keeps {kg(o.co2Saved)} of CO₂ out of Vilnius
					air. Added to your savings.
				</p>
			)}
			{going && !o.green && o.co2 > 0 && (
				<p className="impact-nudge">
					<Leaf size={15} />
					This trip emits {kg(o.co2)} CO₂. Next time, try the bus — it’s part of
					how Vilnius gets cleaner.
				</p>
			)}
			{o.quotes && going && (
				<Providers quotes={o.quotes} mode={o.mode} trip={trip} />
			)}
			{!going && (
				<button type="button" className="option-select" onClick={onGo}>
					Go this way
					<ArrowRight size={15} />
				</button>
			)}
		</li>
	);
}

/** Side-by-side taxi or car-sharing apps for this trip, recommended one first. */
function Providers({
	quotes,
	mode,
	trip,
}: {
	quotes: Quote[];
	mode: Mode;
	trip: { from: Position; to: Place };
}) {
	return (
		<div className="providers">
			<h4>
				{mode === "taxi" ? "Compare taxi apps" : "Compare car-sharing services"}
			</h4>
			<ol>
				{quotes.map((q, i) => {
					const link = q.url ? bookingLink(q, trip.from, trip.to) : "";
					return (
						<li key={q.id} className={i === 0 ? "recommended" : ""}>
							<div className="provider-main">
								<span className="provider-name">
									{i === 0 && <span className="provider-pick">Best pick</span>}
									<strong>{q.name}</strong>
									<small>
										{mode === "taxi"
											? `Pickup in ~${q.reach} min`
											: `Nearest car ~${q.reach} min walk`}
										{q.note ? ` · ${q.note}` : ""}
									</small>
								</span>
								<span className="provider-price">
									{q.price === null
										? "Price in app"
										: q.priceHigh
											? `€${q.price.toFixed(2)}–${q.priceHigh.toFixed(2)}`
											: `~€${q.price.toFixed(2)}`}
								</span>
							</div>
							<div className="provider-badges">
								{q.badges.map((b) => (
									<span key={b} className={b.startsWith("Surge") ? "warn" : ""}>
										{b}
									</span>
								))}
							</div>
							{link && (
								<a
									className="provider-open"
									href={link}
									target="_blank"
									rel="noreferrer"
								>
									Open {q.name.split(" ")[0]}
									<ExternalLink size={13} />
								</a>
							)}
						</li>
					);
				})}
			</ol>
			<p className="helper-text">
				Estimates from published tariffs; each app shows the exact price before
				you book.
			</p>
		</div>
	);
}

const metres = (m: number) =>
	m < 1000
		? `${Math.max(10, Math.round(m / 10) * 10)} m`
		: `${(m / 1000).toFixed(1)} km`;

/** Step by step: which bus, where to board and get off, where to change. */
function Itinerary({
	legs,
	routes,
}: {
	legs: NamedRide[];
	routes: Map<string, TransitRoute>;
}) {
	return (
		<ol className="itinerary">
			<li className="step-walk">
				<Footprints size={14} />
				<span>
					Walk {metres(legs[0].walkToMetres)} to{" "}
					<strong>{legs[0].fromStop}</strong>
				</span>
			</li>
			{legs.map((leg, i) => {
				const route = routes.get(leg.routeId);
				const name = route?.name ?? "";
				const delay = leg.delaySeconds ?? 0;
				return (
					<Fragment key={`${leg.tripId}-${leg.fromStopId}`}>
						{i > 0 && (
							<li className="step-walk">
								<Footprints size={14} />
								<span>
									{leg.walkToMetres > 15 ? (
										<>
											Change: walk {metres(leg.walkToMetres)} to{" "}
											<strong>{leg.fromStop}</strong>
										</>
									) : (
										<>
											Change at <strong>{leg.fromStop}</strong>
										</>
									)}
								</span>
							</li>
						)}
						<li className="step-ride">
							<span
								className="route-badge"
								style={{
									background: serviceColor(name, route?.mode, route?.color),
									color: "white",
								}}
							>
								{name}
							</span>
							<span>
								<span>
									<strong>
										{route?.mode === "trolleybus" ? "Trolleybus" : "Bus"} {name}
									</strong>{" "}
									towards {leg.destination}
								</span>
								<small>
									{leg.live && <Radio size={10} />} Board at{" "}
									{time.format(leg.departAt)}
									{leg.live
										? Math.abs(delay) >= 60
											? ` (live, ${Math.round(Math.abs(delay) / 60)} min ${delay > 0 ? "late" : "early"})`
											: " (live)"
										: ""}{" "}
									· {leg.stops} stop{leg.stops === 1 ? "" : "s"} · get off at{" "}
									<strong>{leg.toStop}</strong> at {time.format(leg.arriveAt)}
								</small>
							</span>
						</li>
					</Fragment>
				);
			})}
			<li className="step-walk">
				<Footprints size={14} />
				<span>
					Walk {metres(legs[legs.length - 1].walkFromMetres)} to your
					destination
				</span>
			</li>
		</ol>
	);
}
