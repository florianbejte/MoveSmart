"use client";

import {
	ArrowLeft,
	ArrowRight,
	ArrowUpDown,
	Bike,
	BusFront,
	Car,
	CarTaxiFront,
	ChevronDown,
	Clock3,
	CloudSun,
	ExternalLink,
	Footprints,
	KeyRound,
	Leaf,
	LocateFixed,
	MapPin,
	Megaphone,
	Navigation,
	Pencil,
	Radio,
	Search,
	Sparkles,
	TriangleAlert,
	Users,
	X,
	Zap,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { placeKindLabel } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/react";
import {
	DISRUPTION_INFO,
	type Disruption,
	type TripImpact,
	tripImpact,
} from "@/lib/plan/disruptions";
import type { GeocodeHit } from "@/lib/plan/geocode";
import {
	estimateOptions,
	kg,
	type Mode,
	type RankedOption,
	rankOptions,
	type Weather,
	type Weights,
	weightsFor,
} from "@/lib/plan/options";
import { sliceShape } from "@/lib/plan/paths";
import { type Profile, persona, walkPace } from "@/lib/plan/profile";
import { bookingLink, type Quote } from "@/lib/plan/providers";
import type { TransitRide } from "@/lib/plan/transit";
import { distance } from "@/lib/transit/core";
import { serviceColor } from "@/lib/transit/service-colors";
import type { Position, Stop, TransitRoute } from "@/lib/transit/types";
import { type AreaReportKind, useAccount } from "../account";
import { FormulaDetails } from "./formula";
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
	/** Places to avoid near the trip, drawn as zones. */
	avoid?: {
		lat: number;
		lon: number;
		radius: number;
		avoid: boolean;
		title: string;
	}[];
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
	disruptions?: Disruption[];
	stale: boolean;
	walkingApproximate?: boolean;
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
	const t = useT();

	const account = useAccount();
	const [query, setQuery] = useState("");
	const [to, setTo] = useState<Place | null>(null);
	// A typed start point; null means "where I am" (my location, or the city centre).
	const [fromPlace, setFromPlace] = useState<Place | null>(null);
	const [editingFrom, setEditingFrom] = useState(false);
	const [fromQuery, setFromQuery] = useState("");
	// The start is fixed when the destination is chosen, so panning the map to the route
	// doesn't re-plan the trip; a new location fix does.
	const [start, setStart] = useState<Position>(origin);
	// The option the rider decided to go with; only then does the map open.
	const [going, setGoing] = useState<string | null>(null);
	function choose(place: Place) {
		setTo(place);
		setStart(fromPlace ?? origin);
		setGoing(null);
		onPlace(place);
	}
	function chooseFrom(place: Place | null) {
		setFromPlace(place);
		setStart(place ?? origin);
		setEditingFrom(false);
		setFromQuery("");
		setGoing(null);
		if (!place) onLocate();
	}
	function swap() {
		if (!to) return;
		const here = fromPlace ?? {
			name: usingLocation ? "My location" : "City centre",
			...start,
		};
		setFromPlace(to);
		setStart(to);
		setTo(here);
		setGoing(null);
	}
	// biome-ignore lint/correctness/useExhaustiveDependencies: only a new location fix should move the start.
	useEffect(() => {
		if (usingLocation && !fromPlace) setStart(origin);
	}, [usingLocation, origin.lat, origin.lon]);
	const [travelMode, setTravelMode] = useState("transit");
	const [showMore, setShowMore] = useState(false);
	const [maxWalk, setMaxWalk] = useState(20);
	const [showExcluded, setShowExcluded] = useState(false);
	const toSearch = usePlaceSearch(query, stops);
	const fromSearch = usePlaceSearch(fromQuery, stops);
	const from = {
		lat: Math.round(start.lat * 2000) / 2000,
		lon: Math.round(start.lon * 2000) / 2000,
	};
	const planUrl =
		to && !hidden
			? `/api/plan?from=${from.lat},${from.lon}&to=${to.lat.toFixed(5)},${to.lon.toFixed(5)}&pace=${walkPace(profile)}&walk=${maxWalk}`
			: null;
	const plan = useTransit<PlanResponse>(planUrl, 60_000);
	const conditions = useTransit<{
		weather: Weather | null;
		disruptions: Disruption[];
	}>(planUrl ? `${planUrl}&part=conditions` : null, 60_000);
	const routeName = (id: string) => routes.get(id)?.name ?? "";
	// Official closures and incidents plus rider reports (protests, crowds, blocked roads).
	const disruptions = useMemo(
		() => [...(conditions.data?.disruptions ?? []), ...account.areaReports],
		[conditions.data, account.areaReports],
	);
	const { ranked, impact } = useMemo(() => {
		if (!to || !plan.data) return { ranked: [], impact: null };
		const options = estimateOptions({
			from: start,
			to,
			now: plan.data.generatedAt,
			rides: plan.data.rides,
			transfers: plan.data.transfers,
			routeName: (id) => routes.get(id)?.name ?? "",
			profile,
		});
		const impact = tripImpact(
			{ from: start, to },
			options,
			disruptions,
			plan.data.generatedAt,
			(id) => stops.find((s) => s.id === id),
			(id) => routes.get(id)?.name ?? "",
		);
		for (const o of options) {
			const hit = impact.options.get(o.id);
			if (hit)
				o.disruption = {
					minutes: hit.minutes,
					titles: hit.found.map(
						(d) => `${DISRUPTION_INFO[d.kind].label}: ${d.title}`,
					),
				};
		}
		return {
			ranked: rankOptions(options, profile, conditions.data?.weather ?? null),
			impact,
		};
	}, [
		to,
		plan.data,
		conditions.data,
		profile,
		start,
		routes,
		disruptions,
		stops,
	]);
	const usable = ranked.filter((o) => !o.excluded);
	const filteredOptions = usable.filter(
		(o) =>
			travelMode === "all" ||
			(travelMode === "cycle"
				? ["bike", "scooter"].includes(o.mode)
				: travelMode === "drive"
					? ["car", "taxi", "carshare"].includes(o.mode)
					: o.mode === travelMode),
	);
	const visibleOptions = showMore
		? filteredOptions
		: filteredOptions.slice(0, 3);
	// Stop names and headsigns from the server, for every bus in every option.
	const named = new Map<string, NamedRide>();
	for (const r of [
		...(plan.data?.rides ?? []),
		...(plan.data?.transfers ?? []).flatMap((t) => t.legs),
	])
		named.set(legKey(r), r);
	const excluded = ranked.filter((o) => o.excluded);
	const weather = conditions.data?.weather ?? null;
	const weights = weightsFor(profile, weather);

	const tooClose = to && distance(start, to) < 150;
	const selected = usable.find((o) => o.id === going);
	const stage = selected && !hidden ? "map" : "choose";
	// biome-ignore lint/correctness/useExhaustiveDependencies: onStage is a stable state setter.
	useEffect(() => onStage(stage), [stage]);
	const zones = useMemo(() => {
		if (!impact) return [];
		const found = [
			...impact.destination,
			...impact.start,
			...(selected ? (impact.options.get(selected.id)?.found ?? []) : []),
		];
		return [...new Map(found.map((d) => [d.id, d])).values()].map((d) => ({
			lat: d.lat,
			lon: d.lon,
			radius: DISRUPTION_INFO[d.kind].radius,
			avoid: DISRUPTION_INFO[d.kind].advice === "avoid",
			title: `${DISRUPTION_INFO[d.kind].label}: ${d.title}`,
		}));
	}, [impact, selected]);
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
					avoid: zones,
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
				avoid: zones,
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
		<section
			className="trip-planner"
			hidden={hidden}
			aria-label={t("Plan a trip")}
		>
			<div className="plan-points">
				<div className="plan-point">
					<span className="point-dot from" />
					{editingFrom ? (
						<label className="plan-search">
							<Search size={16} />
							<input
								// biome-ignore lint/a11y/noAutofocus: the rider just asked to type a start point.
								autoFocus
								value={fromQuery}
								onChange={(e) => setFromQuery(e.target.value)}
								placeholder={t("Start point")}
								aria-label={t("Start point")}
							/>
						</label>
					) : (
						<button
							type="button"
							className="point-text point-edit"
							onClick={() => setEditingFrom(true)}
							aria-label={t("Change start point")}
						>
							<small>{t("From")}</small>
							{fromPlace?.name ??
								t(usingLocation ? "My location" : "City centre")}
						</button>
					)}
					{editingFrom ? (
						<button
							type="button"
							onClick={() => {
								setEditingFrom(false);
								setFromQuery("");
							}}
							aria-label={t("Cancel")}
						>
							<X size={16} />
						</button>
					) : (
						<button
							type="button"
							onClick={() => chooseFrom(null)}
							disabled={locating}
							aria-label={t("Start from my location")}
						>
							<LocateFixed size={16} className={locating ? "spin" : ""} />
						</button>
					)}
				</div>
				{to && !editingFrom && (
					<button
						type="button"
						className="plan-swap"
						onClick={swap}
						aria-label={t("Swap start and destination")}
					>
						<ArrowUpDown size={15} />
					</button>
				)}
				<div className="plan-point">
					<span className="point-dot to" />
					{to ? (
						<>
							<span className="point-text">
								<small>{t("To")}</small>
								{t(to.name)}
							</span>
							<button
								type="button"
								onClick={() => {
									setTo(null);
									setQuery("");
									setGoing(null);
									onPath(null);
								}}
								aria-label={t("Change destination")}
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
								placeholder={t("Where to?")}
								aria-label={t("Destination")}
							/>
						</label>
					)}
				</div>
			</div>
			<details className="journey-settings">
				<summary>
					{t("Options")}
					{t(" ")}
					<span>
						{t("Up to ")}
						{t(maxWalk)}
						{t(" min walking ")}
						<ChevronDown size={14} />
					</span>
				</summary>

				<label className="plan-walk-budget">
					<span>
						<Footprints size={16} />
						{t(" Walk to / from a stop")}
					</span>
					<select
						aria-label={t("Maximum walk at each end")}
						value={maxWalk}
						onChange={(e) => {
							setMaxWalk(Number(e.target.value));
							setGoing(null);
						}}
					>
						{[10, 15, 20, 30].map((n) => (
							<option key={n} value={n}>
								{t("Up to ")}
								{t(n)}
								{t(" min each end")}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					className="profile-chip"
					onClick={onEditProfile}
					aria-label={t("Edit travel profile")}
				>
					<Sparkles size={15} />
					<span>
						{t("Ranked for ")}
						<strong>{t(persona(profile))}</strong>
					</span>
					<Pencil size={13} />
				</button>
				<p className="impact-banner">
					<Leaf size={15} />
					{account.impact.trips > 0 ? (
						<span>
							{t("You’ve saved ")}
							<strong>{t(kg(account.impact.grams))} CO₂</strong>
							{t(" in")}
							{t(" ")}
							{t(`Green trips: ${account.impact.trips}`)}
						</span>
					) : (
						<span>
							{t(
								"Every bus, walk or bike trip instead of a car saves CO₂ — we’ll count yours.",
							)}
						</span>
					)}
				</p>
			</details>
			<fieldset className="journey-modes" aria-label={t("Travel mode")}>
				{[
					{ id: "transit", label: "Transit", icon: BusFront },
					{ id: "walk", label: "Walk", icon: Footprints },
					{ id: "cycle", label: "Cycle", icon: Bike },
					{ id: "drive", label: "Car", icon: Car },
					{ id: "all", label: "All", icon: Sparkles },
				].map(({ id, label, icon: ModeIcon }) => (
					<button
						key={id}
						type="button"
						aria-label={t(label)}
						aria-pressed={travelMode === id}
						onClick={() => {
							setTravelMode(id);
							setShowMore(false);
							setGoing(null);
						}}
					>
						<ModeIcon size={17} />
						<span>
							{t(
								id === "transit" ? "Buses" : id === "drive" ? "By car" : label,
							)}
						</span>
					</button>
				))}
			</fieldset>
			{to && plan.data?.walkingApproximate && (
				<p className="helper-text" role="status">
					{t(
						"Walking directions are unavailable for some stops. Those walking times are approximate.",
					)}
				</p>
			)}
			{to &&
				plan.data &&
				!plan.data.rides.length &&
				!plan.data.transfers?.length && (
					<p className="helper-text">
						{t(
							"No direct or one-change bus journey found within this walking budget. Try allowing a longer walk.",
						)}
					</p>
				)}
			{editingFrom && (
				<div className="plan-suggestions">
					<button type="button" onClick={() => chooseFrom(null)}>
						<LocateFixed size={15} />
						<span className="suggestion-text">
							<span>{t("My current location")}</span>
							<small>{t("Uses your device’s location")}</small>
						</span>
					</button>
					{!fromQuery && places.length > 0 && (
						<RecentPlaces places={places} onChoose={chooseFrom} />
					)}
					<Suggestions search={fromSearch} onChoose={chooseFrom} />
				</div>
			)}
			{!to && !editingFrom && (
				<div className="plan-suggestions">
					{!query && places.length > 0 && (
						<RecentPlaces places={places} onChoose={choose} />
					)}
					<Suggestions search={toSearch} onChoose={choose} />
					<p className="helper-text">
						{t("Choose a destination to compare your best routes.")}
					</p>
				</div>
			)}
			{to && tooClose && (
				<p className="notice">{t("You’re practically there — just walk.")}</p>
			)}
			{to && !tooClose && !plan.data && !plan.error && (
				<p className="loading-text">{t("Comparing every way to get there…")}</p>
			)}
			{plan.error && (
				<div className="notice warning">
					{t("Couldn’t check live buses right now.")}
					<button type="button" onClick={plan.retry}>
						{t("Try again")}
					</button>
				</div>
			)}
			{to && !tooClose && plan.data && (
				<>
					{!conditions.data && (
						<p className="helper-text" role="status">
							{t(
								conditions.error
									? "Conditions unavailable. Routes use timetable and live vehicle data."
									: "Routes ready. Checking weather and disruptions…",
							)}
						</p>
					)}
					{impact && <TripAdvice impact={impact} />}
					{!selected && (
						<TripConditions
							weather={weather}
							weights={weights}
							options={usable}
							impact={impact}
						/>
					)}
					{selected && (
						<button
							type="button"
							className="back-to-options"
							onClick={() => setGoing(null)}
						>
							<ArrowLeft size={15} />
							{t("All options")}
						</button>
					)}
					{!selected && (
						<div className="journey-list-heading">
							<h3>
								{t(
									travelMode === "transit"
										? "Suggested journeys"
										: "Ways to go",
								)}
							</h3>
							<span>{t("Leave now")}</span>
						</div>
					)}
					{!selected && !filteredOptions.length && (
						<p className="notice">
							{t(
								"No journeys match these options. Try another mode or adjust Trip options.",
							)}
						</p>
					)}
					{!selected && usable.length > 0 && (
						<p className="formula-lead">
							{t(
								" Ranked for your needs and answers — with greener ways first. ",
							)}
						</p>
					)}
					<ol className="plan-options">
						{(selected ? [selected] : visibleOptions).map((o, i) => (
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
								weights={weights}
								runnerUp={i === 0 ? usable[1] : usable[0]}
								onGo={() => {
									setGoing(o.id);
									if (o.green) account.logGreenTrip(o.mode, o.co2Saved);
								}}
								trip={{ from: start, to }}
							/>
						))}
					</ol>
					{!selected && filteredOptions.length > 3 && (
						<button
							type="button"
							className="journey-more"
							onClick={() => setShowMore(!showMore)}
						>
							{t(
								showMore
									? "Show fewer journeys"
									: `Show ${filteredOptions.length - 3} more journeys`,
							)}
							<ChevronDown size={16} />
						</button>
					)}

					{excluded.length > 0 && !selected && (
						<div className="plan-excluded">
							<button
								type="button"
								aria-expanded={showExcluded}
								onClick={() => setShowExcluded(!showExcluded)}
							>
								{t("Not suggested for you (")}
								{t(excluded.length)})
								<ChevronDown size={14} />
							</button>
							{showExcluded && (
								<ul>
									{excluded.map((o) => {
										const Icon = ICONS[o.mode];
										return (
											<li key={o.id}>
												<Icon size={15} />
												<strong>{t(o.label)}</strong>
												<span>{t(o.excluded)}</span>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					)}
					<ReportTrouble
						places={[
							{ label: `Near ${to.name}`, at: to },
							{
								label: usingLocation ? "Where I am now" : "Where I start",
								at: start,
							},
						]}
					/>
					<details className="journey-settings">
						<summary>{t("About these results")}</summary>
						<p className="helper-text">
							{t(
								"Bus search includes direct journeys and one change. Walks between transfer stops are approximate. Bus times are live where vehicles report them. Driving, taxi and shared-vehicle times and prices are Vilnius estimates.",
							)}
						</p>
					</details>
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
	weights,
	runnerUp,
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
	weights: Weights;

	runnerUp?: RankedOption;
	onGo: () => void;
	trip: { from: Position; to: Place };
}) {
	const t = useT();

	const [expanded, setExpanded] = useState(false);
	const Icon = ICONS[o.mode];
	const ride = legs?.[0];
	const change = legs && legs.length > 1 ? legs[1] : undefined;
	const leaveIn = Math.round((o.departAt - now) / 60_000);
	const top = o.quotes?.find((q) => q.price !== null);
	if (!expanded && !going)
		return (
			<li className="journey-compact">
				<button
					type="button"
					className="journey-summary"
					aria-expanded={false}
					onClick={() => setExpanded(true)}
					aria-label={t(`View ${o.label}, ${o.minutes} minutes`)}
				>
					<div className="journey-summary-top">
						<span>
							{t(
								best
									? "Suggested"
									: o.mode === "transit"
										? change
											? "1 change"
											: "Direct"
										: o.label,
							)}
						</span>
						<strong>
							{t(o.minutes)}
							<small>{t(" min")}</small>
						</strong>
					</div>
					<div className="journey-track">
						{ride ? (
							<>
								<span className="journey-walk">
									<Footprints size={17} />
									<small>{t(ride.walkToMinutes ?? "")}</small>
								</span>
								<span className="journey-dots" />
								{legs?.map((leg, i) => (
									<Fragment key={`${leg.tripId}-${i}`}>
										{i > 0 && <span className="journey-dots" />}
										<span
											className="journey-line"
											style={{
												background: serviceColor(
													routes.get(leg.routeId)?.name ?? "",
													routes.get(leg.routeId)?.mode,
													routes.get(leg.routeId)?.color,
												),
											}}
										>
											<BusFront size={16} />
											{t(routes.get(leg.routeId)?.name)}
										</span>
									</Fragment>
								))}
								<span className="journey-dots" />
								<Footprints size={17} />
							</>
						) : (
							<>
								<span className={`journey-mode-icon mode-${o.mode}`}>
									<Icon size={21} />
								</span>
								<strong>{t(o.label)}</strong>
							</>
						)}
					</div>
					<div className="journey-summary-bottom">
						<span>
							{ride ? (
								<>
									<strong>
										{t(leaveIn <= 0 ? "Leave now" : `Leave in ${leaveIn} min`)}
									</strong>
									{ride.live && <Radio size={12} />}
								</>
							) : (
								<strong>
									{t(o.parts.walk ? `${o.parts.walk} min walk` : "Ready to go")}
								</strong>
							)}
							<small>
								{t(ride ? `${o.parts.walk} min walk · ` : "")}
								{t(
									o.cost === 0
										? "Free"
										: `€${(top?.price ?? o.cost).toFixed(2)}`,
								)}
							</small>
						</span>
						<span className="journey-arrival">
							{t(time.format(o.arriveAt))}
							<ArrowRight size={17} />
						</span>
					</div>
				</button>
			</li>
		);

	return (
		<li className={`plan-option ${best ? "best" : ""} ${going ? "going" : ""}`}>
			{!going && (
				<button
					type="button"
					className="journey-collapse"
					aria-expanded={true}
					onClick={() => setExpanded(false)}
				>
					{t("Hide details ")}
					<ChevronDown size={15} />
				</button>
			)}
			{best && (
				<span className={`best-tag ${o.green ? "green" : ""}`}>
					{t(
						o.promoted === "greener"
							? "Greener way"
							: o.green
								? "Best for you & Vilnius"
								: "Best for you",
					)}
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
						{t(o.label)}
						{ride && !change && <small> → {t(ride.destination)}</small>}
					</strong>
					<small>
						{t(
							change
								? `Change at ${legs?.[0].toStop}`
								: ride
									? `${ride.fromStop} → ${ride.toStop} · ${ride.stops} stops`
									: (o.notes[0] ?? ""),
						)}
					</small>
				</span>
				<span className="plan-time">
					<strong>
						{t(o.minutes)}
						<small>{t(" min")}</small>
					</strong>
					<small>
						{t("arrive ")}
						{t(time.format(o.arriveAt))}
					</small>
				</span>
			</div>
			<div className="plan-facts">
				{o.mode === "transit" && !o.estimated && (
					<span className={ride?.live ? "live" : ""}>
						{ride?.live && <Radio size={11} />}
						{t(leaveIn <= 0 ? "Leave now" : `Leave in ${leaveIn} min`)}
					</span>
				)}
				{o.parts.walk > 0 && (
					<span>
						<Footprints size={11} />
						{t(o.parts.walk)}
						{t(" min walk")}
					</span>
				)}
				{o.parts.wait > 0 && o.mode !== "transit" && (
					<span>
						{t(o.parts.wait)}
						{t(" min wait")}
					</span>
				)}
				<span>
					{t(
						o.cost === 0
							? "Free"
							: `${o.quotes ? "from " : ""}€${(top?.price ?? o.cost).toFixed(2)}`,
					)}
				</span>
				{o.green && o.co2Saved >= 50 ? (
					<span className="co2-good">
						<Leaf size={11} />
						{t("Saves ")}
						{t(kg(o.co2Saved))} CO₂
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
						{t(kg(o.co2))} CO₂
					</span>
				)}
			</div>

			{legs && legs.length > 0 && <Itinerary legs={legs} routes={routes} />}
			{o.reasons.length > 0 && (
				<ul className="plan-reasons">
					{o.reasons.slice(0, best || going ? 4 : 2).map((r) => (
						<li key={r}>{t(r)}</li>
					))}
				</ul>
			)}
			{o.disruption && (
				<div className="trouble">
					<TriangleAlert size={14} />
					<span>
						<strong>
							{t(" Trouble on the way · about +")}
							{o.disruption.minutes}
							{t(" min ")}
						</strong>
						{o.disruption.titles.slice(0, 3).map((t) => (
							<small key={t}>{t}</small>
						))}
					</span>
				</div>
			)}
			<FormulaDetails option={o} weights={weights} runnerUp={runnerUp} />
			{going && o.green && o.co2Saved >= 50 && (
				<p className="impact-thanks">
					<Leaf size={15} />
					{t("Nice choice — this trip keeps ")}
					{t(kg(o.co2Saved))}
					{t(" of CO₂ out of Vilnius air. Added to your savings.")}
				</p>
			)}
			{going && !o.green && o.co2 > 0 && (
				<p className="impact-nudge">
					<Leaf size={15} />
					{t("This trip emits ")}
					{t(kg(o.co2))}
					{t(
						" CO₂. Next time, try the bus — it’s part of how Vilnius gets cleaner.",
					)}
				</p>
			)}
			{o.quotes && going && (
				<Providers quotes={o.quotes} mode={o.mode} trip={trip} />
			)}
			{!going && (
				<button type="button" className="option-select" onClick={onGo}>
					{t("Go this way")}
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
	const t = useT();

	return (
		<div className="providers">
			<h4>
				{t(
					mode === "taxi"
						? "Compare taxi apps"
						: "Compare car-sharing services",
				)}
			</h4>
			<ol>
				{quotes.map((q, i) => {
					const link = q.url ? bookingLink(q, trip.from, trip.to) : "";
					return (
						<li key={q.id} className={i === 0 ? "recommended" : ""}>
							<div className="provider-main">
								<span className="provider-name">
									{i === 0 && (
										<span className="provider-pick">{t("Best pick")}</span>
									)}
									<strong>{t(q.name)}</strong>
									<small>
										{t(
											mode === "taxi"
												? `Pickup in ~${q.reach} min`
												: `Nearest car ~${q.reach} min walk`,
										)}
										{t(q.note ? ` · ${q.note}` : "")}
									</small>
								</span>
								<span className="provider-price">
									{t(
										q.price === null
											? "Price in app"
											: q.priceHigh
												? `€${q.price.toFixed(2)}–${q.priceHigh.toFixed(2)}`
												: `~€${q.price.toFixed(2)}`,
									)}
								</span>
							</div>
							<div className="provider-badges">
								{q.badges.map((b) => (
									<span key={b} className={b.startsWith("Surge") ? "warn" : ""}>
										{t(b)}
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
									{t("Open ")}
									{t(q.name.split(" ")[0])}
									<ExternalLink size={13} />
								</a>
							)}
						</li>
					);
				})}
			</ol>
			<p className="helper-text">
				{t(
					"Estimates from published tariffs; each app shows the exact price before you book.",
				)}
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
	const t = useT();

	return (
		<ol className="itinerary">
			<li className="step-walk">
				<Footprints size={14} />
				<span>
					{t("Walk ")}
					{t(metres(legs[0].walkToMetres))}
					{t(" to")}
					{t(" ")}
					<strong>{t(legs[0].fromStop)}</strong>
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
											{t("Change: walk ")}
											{t(metres(leg.walkToMetres))}
											{t(" to")}
											{t(" ")}
											<strong>{t(leg.fromStop)}</strong>
										</>
									) : (
										<>
											{t("Change at ")}
											<strong>{t(leg.fromStop)}</strong>
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
								{t(name)}
							</span>
							<span>
								<span>
									<strong>
										{t(route?.mode === "trolleybus" ? "Trolleybus" : "Bus")}
										{t(" ")}
										{t(name)}
									</strong>
									{t(" ")}
									{t("towards ")}
									{t(leg.destination)}
								</span>
								<small>
									{leg.live && <Radio size={10} />}
									{t(" Board at")}
									{t(" ")}
									{t(time.format(leg.departAt))}
									{t(
										leg.live
											? Math.abs(delay) >= 60
												? ` (live, ${Math.round(Math.abs(delay) / 60)} min ${delay > 0 ? "late" : "early"})`
												: " (live)"
											: "",
									)}
									{t(" ")}· {t(`Stops: ${leg.stops}`)}
									{t(" · get off at")}
									{t(" ")}
									<strong>{t(leg.toStop)}</strong>
									{t(" at ")}
									{t(time.format(leg.arriveAt))}
								</small>
							</span>
						</li>
					</Fragment>
				);
			})}
			<li className="step-walk">
				<Footprints size={14} />
				<span>
					{t("Walk ")}
					{t(metres(legs[legs.length - 1].walkFromMetres))}
					{t(" to your destination")}
				</span>
			</li>
		</ol>
	);
}

const ago = (at?: number) => {
	if (!at) return "";
	const min = Math.max(1, Math.round((Date.now() - at) / 60_000));
	return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};
const until = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Vilnius",
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
});

/** Advice when something to avoid is at the destination or the start. */
function TripAdvice({ impact }: { impact: TripImpact }) {
	const t = useT();
	const places = [
		...impact.destination.map((d) => ({ d, where: "your destination" })),
		...impact.start.map((d) => ({ d, where: "where you start" })),
	];
	if (!places.length) return null;
	const avoid = places.filter(
		({ d }) => DISRUPTION_INFO[d.kind].advice === "avoid",
	);
	const [{ d: worst, where }] = avoid.length ? avoid : places;
	const info = DISRUPTION_INFO[worst.kind];
	return (
		<div
			className={`trip-advice ${info.advice === "avoid" ? "avoid" : ""}`}
			role="alert"
		>
			<TriangleAlert size={18} />
			<div>
				<strong>
					{info.advice === "avoid"
						? `Avoid if you can: ${info.label.toLowerCase()} near ${where}`
						: `${info.label} near ${where}`}
				</strong>
				<p>
					{worst.title}
					{worst.source === "riders"
						? ` · reported by ${worst.reports ?? 1} rider${(worst.reports ?? 1) === 1 ? "" : "s"}, ${ago(worst.reportedAt)}`
						: worst.end
							? ` · official, until ${until.format(worst.end)}`
							: " · official"}
				</p>
				<p>
					{info.advice === "avoid"
						? "Consider going later or meeting somewhere else. If you need to go, take public transport or walk — nearby roads may be closed and taxis can get stuck."
						: "Drivers may need a detour. Public transport and walking are usually less affected."}
				</p>
				{places.length > 1 && (
					<small>
						{t(" Also nearby:")}{" "}
						{places
							.filter((p) => p.d !== worst)
							.slice(0, 3)
							.map((p) => p.d.title)
							.join(" · ")}
					</small>
				)}
			</div>
		</div>
	);
}

const REPORT_KINDS: { kind: AreaReportKind; label: string }[] = [
	{ kind: "protest", label: "Protest or rally" },
	{ kind: "event", label: "Big event crowds" },
	{ kind: "blocked", label: "Road blocked" },
	{ kind: "emergency", label: "Police or emergency" },
];

/** Waze-style: riders flag what official feeds don't publish, like protests. */
function ReportTrouble({
	places,
}: {
	places: { label: string; at: Position }[];
}) {
	const t = useT();
	const account = useAccount();
	const [open, setOpen] = useState(false);
	const [kind, setKind] = useState<AreaReportKind>("protest");
	const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
		"idle",
	);
	if (!account.enabled) return null;
	return (
		<div className="report-trouble">
			<button
				type="button"
				className="report-trouble-toggle"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				<Megaphone size={15} />
				{t(" See a protest, crowd or blocked road? Warn others ")}
			</button>
			{open &&
				(account.status !== "signed-in" ? (
					<p className="helper-text">
						<a href="/dashboard?mode=signin">{t("Sign in")}</a>
						{t(" to report — it keeps reports trustworthy. ")}
					</p>
				) : state === "sent" ? (
					<p className="impact-thanks">
						{t(
							" Thanks — riders planning trips nearby will be warned for the next 3 hours. ",
						)}
					</p>
				) : (
					<div className="report-trouble-panel">
						<div className="report-kinds">
							{REPORT_KINDS.map((k) => (
								<button
									type="button"
									key={k.kind}
									aria-pressed={kind === k.kind}
									onClick={() => setKind(k.kind)}
								>
									{k.label}
								</button>
							))}
						</div>
						<small>{t("Where?")}</small>
						<div className="report-places">
							{places.map((p) => (
								<button
									type="button"
									key={p.label}
									disabled={state === "sending"}
									onClick={async () => {
										setState("sending");
										try {
											setState(
												(await account.reportArea(kind, p.at))
													? "sent"
													: "error",
											);
										} catch {
											setState("error");
										}
									}}
								>
									<MapPin size={13} />
									{p.label}
								</button>
							))}
						</div>
						{state === "error" && (
							<p className="helper-text">
								{t(" Couldn’t send the report. Try again. ")}
							</p>
						)}
					</div>
				))}
		</div>
	);
}

type PlaceSearch = ReturnType<typeof usePlaceSearch>;
/** Stops by name, plus addresses and places looked up after a short pause in typing. */
function usePlaceSearch(query: string, stops: Stop[]) {
	const stopHits = useMemo(() => {
		const needle = fold(query.trim());
		if (needle.length < 2) return [];
		const seen = new Set<string>();
		return stops
			.filter((s) => fold(s.name).includes(needle))
			.filter((s) => !seen.has(s.name) && seen.add(s.name))
			.slice(0, 3);
	}, [stops, query]);
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
	const q = query.trim();
	return {
		stops: stopHits,
		places: q.length >= 3 && lookup.query === q ? lookup.hits : [],
		searching: q.length >= 3 && lookup.query !== q,
		error: !!lookup.error && lookup.query === q,
	};
}

function Suggestions({
	search,
	onChoose,
}: {
	search: PlaceSearch;
	onChoose: (place: Place) => void;
}) {
	const t = useT();
	return (
		<>
			{search.places.map((h) => (
				<button
					type="button"
					key={`${h.name}-${h.lat}-${h.lon}`}
					onClick={() => onChoose({ name: h.name, lat: h.lat, lon: h.lon })}
				>
					<Navigation size={15} />
					<span className="suggestion-text">
						<span>{h.name}</span>
						<small>
							{[h.detail, t(placeKindLabel(h.kind))]
								.filter(Boolean)
								.join(" · ")}
						</small>
					</span>
				</button>
			))}
			{search.searching && (
				<p className="loading-text">{t("Searching addresses and places…")}</p>
			)}
			{search.error && (
				<p className="helper-text">
					{t(" Address search is unavailable right now — stops still work. ")}
				</p>
			)}
			{search.stops.map((s) => (
				<button
					type="button"
					key={s.id}
					onClick={() => onChoose({ name: s.name, lat: s.lat, lon: s.lon })}
				>
					<BusFront size={15} />
					<span className="suggestion-text">
						<span>{s.name}</span>
						<small>{t("Stop")}</small>
					</span>
				</button>
			))}
		</>
	);
}

function RecentPlaces({
	places,
	onChoose,
}: {
	places: Place[];
	onChoose: (place: Place) => void;
}) {
	const t = useT();
	return (
		<div className="recent-places">
			<span>{t("Your places")}</span>
			<div>
				{places.map((p) => (
					<button type="button" key={p.name} onClick={() => onChoose(p)}>
						<MapPin size={13} />
						{p.name}
					</button>
				))}
			</div>
		</div>
	);
}

const crowdLabel = (q: number) =>
	q < 0.25 ? "Quiet" : q < 0.5 ? "Moderate" : q < 0.8 ? "Busy" : "Packed";
function weatherText(w: Weather) {
	const c = w.condition.replace(/-/g, " ");
	return `${Math.round(w.temperature)}° · ${c || "—"}${w.precipitation > 0.2 ? ` · ${w.precipitation} mm rain` : ""}`;
}

/** The live inputs to the rider's formula, so they can see what the ranking is based on. */
function TripConditions({
	weather,
	weights,
	options,
	impact,
}: {
	weather: Weather | null;
	weights: Weights;
	options: RankedOption[];
	impact: TripImpact | null;
}) {
	const t = useT();
	const legs = options.flatMap((o) => o.legs ?? []);
	const crowd = legs.find((l) => l.crowding)?.crowding;
	const learned = legs
		.map((l) => l.expectedDelay)
		.filter((d) => d?.source === "learned");
	const delay = legs.find((l) => l.expectedDelay)?.expectedDelay;
	const trouble = new Map(
		[
			...(impact?.destination ?? []),
			...(impact?.start ?? []),
			...[...(impact?.options.values() ?? [])].flatMap((x) => x.found),
		].map((d) => [d.id, d]),
	);
	const fromRiders = [...trouble.values()].filter((d) => d.source === "riders");
	return (
		<section className="trip-conditions" aria-label={t("Conditions now")}>
			<h3>{t("Conditions now · what your ranking is based on")}</h3>
			<dl>
				<div>
					<dt>
						<CloudSun size={15} />
						{t(" Weather ")}
					</dt>
					<dd>
						{weather ? weatherText(weather) : "Unavailable"}
						<small>
							{weights.m > 1
								? `Walking & cycling count ${weights.m}× (${weights.weather.join(", ")})`
								: "Good for walking — no weather penalty (m(W) = 1)"}
						</small>
					</dd>
				</div>
				<div>
					<dt>
						<Users size={15} />
						{t(" Crowding ")}
					</dt>
					<dd>
						{crowd ? crowdLabel(crowd.value) : "—"}
						<small>
							{crowd?.source === "riders"
								? `Reported by ${crowd.reports} rider${crowd.reports === 1 ? "" : "s"} on your bus`
								: crowd?.source === "route"
									? "From rider reports on this route"
									: "Typical for this time of day"}
						</small>
					</dd>
				</div>
				<div>
					<dt>
						<Clock3 size={15} />
						{t(" Delays ")}
					</dt>
					<dd>
						{delay ? `~${delay.minutes} min expected` : "—"}
						<small>
							{learned.length
								? `Learned from ${Math.max(...learned.map((d) => d?.samples ?? 0))} live GPS readings`
								: "Live bus positions; still learning this route’s usual delay"}
						</small>
					</dd>
				</div>
				<div>
					<dt>
						<TriangleAlert size={15} />
						{t(" Disruptions ")}
					</dt>
					<dd>
						{trouble.size
							? `${trouble.size} near your trip`
							: "None near your trip"}
						<small>
							{fromRiders.length
								? `${fromRiders.length} reported by riders · rest official`
								: "Official closures, roadworks & incidents"}
						</small>
					</dd>
				</div>
			</dl>
			<p className="trip-conditions-weights">
				{t(" Your weights: walking α ")}
				{weights.alpha}
				{t(" · waiting β ")}
				{weights.beta}
				{t(" · change γ ")}
				{weights.gamma}
				{t(" min · crowding δ ")}
				{weights.delta}
				{t(" · delay η")} {weights.eta}
			</p>
		</section>
	);
}
