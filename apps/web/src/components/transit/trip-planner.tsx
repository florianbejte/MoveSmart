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
	Share2,
	Sparkles,
	Ticket,
	TriangleAlert,
	Users,
	X,
	Zap,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { dateLocale, placeKindLabel } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/react";
import { withDemoAccess } from "@/lib/plan/demo";
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
	ticket,
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
import type {
	Position,
	Stop,
	TransitRoute,
	Vehicle,
} from "@/lib/transit/types";
import {
	type AreaReportKind,
	type LiveShareInput,
	useAccount,
} from "../account";
import { TripCompanion } from "./companion";
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
	parkRide?: {
		lot: { name: string; lat: number; lon: number; spaces: number | null };
		driveKm: number;
		ride: NamedRide;
	}[];
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
	vehicles,
	stops,
	routes,
	origin,
	usingLocation,
	locating,
	onLocate,
	profile: savedProfile,
	places,
	onPlace,
	onPath,
	onStage,
	onEditProfile,
	now,
}: {
	hidden: boolean;
	vehicles: Vehicle[];
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

	const [strollerDemo, setStrollerDemo] = useState(false);
	const profile = useMemo(
		() =>
			strollerDemo
				? {
						...savedProfile,
						needs: [...new Set([...savedProfile.needs, "stroller" as const])],
					}
				: savedProfile,
		[savedProfile, strollerDemo],
	);
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
	// The route currently drawn on the map, reused when sharing the trip live.
	const lastPath = useRef<PlanPath | null>(null);
	const emitPath = (path: PlanPath | null) => {
		lastPath.current = path;
		onPath(path);
	};
	// A shared trip link (?to=…&from=…&at=…) opens the same plan.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const read = (key: string): Place | null => {
			const [lat, lon, ...name] = (params.get(key) ?? "").split(",");
			const p = {
				lat: Number(lat),
				lon: Number(lon),
				name: decodeURIComponent(name.join(",")),
			};
			return Number.isFinite(p.lat) &&
				Number.isFinite(p.lon) &&
				p.lat > 54 &&
				p.lat < 55.5
				? { ...p, name: p.name || "Shared place" }
				: null;
		};
		const sharedTo = read("to");
		if (!sharedTo) return;
		const sharedFrom = read("from");
		if (sharedFrom) {
			setFromPlace(sharedFrom);
			setStart(sharedFrom);
		}
		const at = Number(params.get("at"));
		const mode = params.get("when");
		if (at > Date.now() && (mode === "depart" || mode === "arrive"))
			setWhen({ mode, at });
		setTo(sharedTo);
	}, []);
	const toSearch = usePlaceSearch(query, stops);
	const fromSearch = usePlaceSearch(fromQuery, stops);
	const from = {
		lat: Math.round(start.lat * 2000) / 2000,
		lon: Math.round(start.lon * 2000) / 2000,
	};
	// When: leave now, leave at a time, or arrive by a time.
	const [when, setWhen] = useState<{
		mode: "now" | "depart" | "arrive";
		at: number;
	}>(() => ({
		mode: "now",
		at: Math.ceil(Date.now() / 300_000) * 300_000 + 900_000,
	}));
	// "Arrive by" starts searching about one bus trip before the deadline, so you arrive
	// shortly before it rather than an hour early (~4 min per km plus walking and waiting).
	const tripKm = to ? distance(start, to) / 1000 : 0;
	const searchAt =
		when.mode === "depart"
			? when.at
			: when.mode === "arrive"
				? when.at - Math.round(tripKm * 4 + 30) * 60_000
				: null;
	// Only a future time goes in the URL: a past one means "now" on the server, and keeping
	// Date.now() out of the URL stops the plan being refetched on every render.
	const fetchAt =
		searchAt && searchAt > Date.now() + 60_000
			? Math.round(searchAt / 60_000) * 60_000
			: null;
	const planUrl =
		to && !hidden
			? `/api/plan?from=${from.lat},${from.lon}&to=${to.lat.toFixed(5)},${to.lon.toFixed(5)}&pace=${walkPace(profile)}&walk=${maxWalk}${profile.hasCar ? "&car=1" : ""}${fetchAt ? `&at=${fetchAt}` : ""}`
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
		const planNow =
			when.mode === "now"
				? plan.data.generatedAt
				: Math.max(plan.data.generatedAt, searchAt ?? 0);
		let options = estimateOptions({
			from: start,
			to,
			now: planNow,
			leaveJustInTime: when.mode === "arrive",
			rides: plan.data.rides,
			transfers: plan.data.transfers,
			parkRide: plan.data.parkRide,
			routeName: (id) => routes.get(id)?.name ?? "",
			profile,
		});
		const impact = tripImpact(
			{ from: start, to },
			options,
			disruptions,
			// Closures and reports that will be in force when the trip actually happens.
			planNow,
			(id) => stops.find((s) => s.id === id),
			(id) => routes.get(id)?.name ?? "",
		);
		// Expected disruption delay is part of the trip: it moves the arrival time too.
		options = options.map((o) => {
			const hit = impact.options.get(o.id);
			if (!hit) return o;
			return {
				...o,
				minutes: o.minutes + hit.minutes,
				arriveAt: o.arriveAt + hit.minutes * 60_000,
				disruption: {
					minutes: hit.minutes,
					titles: hit.found.map(
						(d) => `${DISRUPTION_INFO[d.kind].label}: ${d.title}`,
					),
				},
			};
		});
		if (when.mode === "arrive")
			// Only trips that make the deadline; other modes leave just in time to arrive at it,
			// unless that leave time has already passed.
			options = options
				.filter((o) => o.mode !== "transit" || o.arriveAt <= when.at)
				.map((o) =>
					o.mode === "transit"
						? o
						: {
								...o,
								departAt: when.at - o.minutes * 60_000,
								arriveAt: when.at,
							},
				)
				.filter((o) => o.departAt >= Date.now() - 60_000);
		return {
			ranked: rankOptions(
				strollerDemo
					? withDemoAccess(options, (id) => routes.get(id)?.name ?? id)
					: options,
				profile,
				conditions.data?.weather ?? null,
			),
			impact,
		};
	}, [
		to,
		plan.data,
		conditions.data,
		strollerDemo,
		profile,
		start,
		routes,
		disruptions,
		stops,
		when,
		searchAt,
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
		...(plan.data?.parkRide ?? []).map((p) => p.ride),
	])
		named.set(legKey(r), r);
	const excluded = ranked.filter((o) => o.excluded);
	const weather = conditions.data?.weather ?? null;
	const weights = weightsFor(profile, weather);

	const tooClose = to && distance(start, to) < 150;
	// Why no buses are shown, so the advice actually helps.
	const searchHour = Number(
		new Intl.DateTimeFormat("en-GB", {
			timeZone: "Europe/Vilnius",
			hour: "numeric",
			hourCycle: "h23",
		}).format(fetchAt ?? Date.now()),
	);
	const noBusAdvice = !plan.data
		? null
		: !plan.data.rides.length && !plan.data.transfers?.length
			? searchHour < 5
				? "No buses or trolleybuses run in the next 90 minutes — night service is limited. Try a later time, a taxi or a shared vehicle."
				: "No direct or one-change bus journey found within this walking budget. Try allowing a longer walk."
			: !usable.some((o) => o.mode === "transit") &&
					ranked.some((o) => o.mode === "transit" && o.excluded)
				? "Buses run here, but every option is over your walking limit. See “Not suggested for you”, or allow a longer walk in Trip options."
				: null;
	// Once the rider has set off, a refresh may no longer list their bus (it has departed):
	// keep showing the option they chose instead of dropping back to the list.
	const [chosenSnapshot, setChosenSnapshot] = useState<RankedOption | null>(
		null,
	);
	const selected =
		usable.find((o) => o.id === going) ??
		(going && chosenSnapshot?.id === going ? chosenSnapshot : undefined);
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
			emitPath(null);
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
					[selected.via ?? start, ends[0][0] as Stop],
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
				if (selected.via)
					segments.push({
						kind: "ride",
						color: PATH_COLORS.car,
						coordinates: await streetPath("car", start, selected.via, signal),
					});
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
				emitPath({
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
			emitPath({
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
									emitPath(null);
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
			<WhenPicker
				when={when}
				onChange={(w) => {
					setWhen(w);
					setGoing(null);
				}}
			/>
			<div className="demo-preferences">
				<label>
					<input
						type="checkbox"
						checked={strollerDemo}
						onChange={(e) => {
							setStrollerDemo(e.target.checked);
							setGoing(null);
						}}
					/>
					<span>{t("Try stroller demo")}</span>
					<small>{t("Demo")}</small>
				</label>
				{strollerDemo && (
					<p>
						{t(
							"Simulated bus occupancy and boarding access. Favours room for a stroller, fewer changes and shorter walks. Not verified accessibility data.",
						)}
					</p>
				)}
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
							<strong>{t(kg(account.impact.grams))} CO₂</strong>{" "}
							{t(
								account.impact.trips === 1
									? "across 1 green trip"
									: `across ${account.impact.trips} green trips`,
							)}
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
			{to && plan.data && noBusAdvice && (
				<p className="helper-text">{t(noBusAdvice)}</p>
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
					{selected && to && (
						<LiveShare
							tripKey={`${selected.id}|${pt(start)}|${pt(to)}`}
							option={selected}
							from={
								fromPlace ?? {
									name: usingLocation ? "My location" : "Start",
									...start,
								}
							}
							to={to}
							when={when}
							path={() => lastPath.current}
							legs={(selected.legs ?? []).map((l) => {
								const n = named.get(legKey(l));
								return {
									tripId: l.tripId,
									routeId: l.routeId,
									route: routes.get(l.routeId)?.name ?? "",
									fromStop: n?.fromStop ?? "",
									toStop: n?.toStop ?? "",
									departAt: l.departAt,
									arriveAt: l.arriveAt,
									delaySeconds: l.delaySeconds ?? null,
								};
							})}
						/>
					)}
					{!!selected?.legs?.length && (
						<TripCompanion
							legs={selected.legs.map((l) => {
								const n = named.get(legKey(l));
								return {
									...l,
									fromStop: n?.fromStop ?? "your stop",
									toStop: n?.toStop ?? "your stop",
									route: routes.get(l.routeId)?.name ?? "",
								};
							})}
							walkMinutes={
								(selected.via ? selected.via.driveMinutes + 3 : 0) +
								(selected.legs[0].walkToMinutes ??
									Math.round(
										(selected.legs[0].walkToMetres * 1.25) / walkPace(profile),
									))
							}
							drive={
								selected.via
									? {
											lot: selected.via.name,
											minutes: selected.via.driveMinutes,
										}
									: undefined
							}
							vehicles={vehicles}
							now={now}
						/>
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
							<span>
								{when.mode === "now"
									? t("Leave now")
									: t(
											`${when.mode === "depart" ? "Leave at" : "Arrive by"} ${dayTime(when.at)}`,
										)}
							</span>
						</div>
					)}
					{!selected && !filteredOptions.length && (
						<p className="notice">
							{when.mode === "arrive" && !usable.length
								? t(
										`Nothing gets you there by ${dayTime(when.at)} any more. Try a later time.`,
									)
								: t(
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
								// The badge marks the overall best option, not just the first in the chosen filter.
								best={o.id === usable[0]?.id && !selected}
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
								hasPass={profile.hasPass}
								weights={weights}
								runnerUp={o.id === usable[0]?.id ? usable[1] : usable[0]}
								onGo={() => {
									setGoing(o.id);
									setChosenSnapshot(o);
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
								label:
									usingLocation && !fromPlace
										? "Where I am now"
										: "Where I start",
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
	hasPass,
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
	hasPass: boolean;
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
					{o.demoAccess && <DemoSuitability option={o} />}
					<div className="journey-summary-bottom">
						<span>
							{ride ? (
								<>
									<strong>{t(leaveLabel(o.departAt, now))}</strong>
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
			{o.demoAccess && <DemoSuitability option={o} />}
			<div className="plan-facts">
				{o.mode === "transit" && !o.estimated && (
					<span className={ride?.live ? "live" : ""}>
						{ride?.live && <Radio size={11} />}
						{t(leaveLabel(o.departAt, now))}
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

			{legs && legs.length > 0 && (
				<Itinerary legs={legs} routes={routes} via={o.via} />
			)}
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
							{t(
								`Trouble on the way · about +${o.disruption.minutes} min, already in the time`,
							)}
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
			{going && o.mode === "transit" && !hasPass && (
				<TicketInfo
					price={
						o.legs?.length
							? ticket(o.legs[0].departAt, o.legs[o.legs.length - 1].arriveAt)
							: 1
					}
				/>
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
	via,
}: {
	legs: NamedRide[];
	routes: Map<string, TransitRoute>;
	via?: RankedOption["via"];
}) {
	const t = useT();

	return (
		<ol className="itinerary">
			{via && (
				<li className="step-walk">
					<Car size={14} />
					<span>
						{t(
							`Drive ${via.driveKm} km (~${via.driveMinutes} min) to the Park & Ride lot at ${via.name} and park for free`,
						)}
						{via.spaces ? ` · ${t(`${via.spaces} spaces`)}` : ""}
					</span>
				</li>
			)}
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
						{weather?.warning && (
							<span className={`weather-warning-chip ${weather.warning.level}`}>
								{t(
									`${weather.warning.level[0].toUpperCase()}${weather.warning.level.slice(1)} warning`,
								)}{" "}
								· {weather.warning.event} ·{" "}
								{t(`until ${time.format(weather.warning.until)}`)}
							</span>
						)}
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

// Day names follow the interface language (Lithuanian or English).
const dayFormat = () =>
	new Intl.DateTimeFormat(dateLocale(), {
		timeZone: "Europe/Vilnius",
		weekday: "short",
		day: "numeric",
		month: "short",
	});
/** "17:40", or "Mon 12 Oct 17:40" when it isn't today. */
function dayTime(at: number) {
	const format = dayFormat();
	const sameDay = format.format(at) === format.format(Date.now());
	return sameDay ? time.format(at) : `${format.format(at)} ${time.format(at)}`;
}
function leaveLabel(departAt: number, now: number) {
	const min = Math.round((departAt - now) / 60_000);
	if (min <= 0) return "Leave now";
	if (min < 60) return `Leave in ${min} min`;
	return `Leave at ${dayTime(departAt)}`;
}
/** Value for <input type="datetime-local"> in Vilnius time. */
function toLocalInput(at: number) {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", {
			timeZone: "Europe/Vilnius",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(at)
			.map((x) => [x.type, x.value]),
	);
	return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Vilnius wall-clock "YYYY-MM-DDTHH:mm" to a timestamp (handles summer time). */
function fromLocalInput(value: string) {
	const guess = Date.parse(`${value}:00Z`);
	if (!Number.isFinite(guess)) return null;
	const shown = Date.parse(`${toLocalInput(guess)}:00Z`);
	return guess - (shown - guess);
}

function WhenPicker({
	when,
	onChange,
}: {
	when: { mode: "now" | "depart" | "arrive"; at: number };
	onChange: (when: { mode: "now" | "depart" | "arrive"; at: number }) => void;
}) {
	const t = useT();
	return (
		<div className="when-picker">
			<fieldset aria-label={t("When")}>
				{(
					[
						["now", "Leave now"],
						["depart", "Leave at"],
						["arrive", "Arrive by"],
					] as const
				).map(([mode, label]) => (
					<button
						type="button"
						key={mode}
						aria-pressed={when.mode === mode}
						onClick={() =>
							onChange({
								mode,
								// A deadline needs room for the trip itself: default to an hour ahead.
								at: Math.max(
									when.at,
									Math.ceil(Date.now() / 300_000) * 300_000 +
										(mode === "arrive" ? 60 : 15) * 60_000,
								),
							})
						}
					>
						{t(label)}
					</button>
				))}
			</fieldset>
			{when.mode !== "now" && (
				<input
					type="datetime-local"
					aria-label={t(when.mode === "depart" ? "Leave at" : "Arrive by")}
					step={300}
					min={toLocalInput(Date.now())}
					value={toLocalInput(when.at)}
					onChange={(e) => {
						const at = fromLocalInput(e.target.value);
						if (at) onChange({ ...when, at });
					}}
				/>
			)}
		</div>
	);
}

/** How to pay for the bus: price for this trip and the official ways to buy. */
function TicketInfo({ price }: { price: number }) {
	const t = useT();
	const long = price > 1;
	return (
		<div className="ticket-info">
			<Ticket size={16} />
			<div>
				<strong>
					{t(long ? "Ticket: 60-minute, €1.25" : "Ticket: 30-minute, €1.00")}
				</strong>
				<small>
					{t(
						"Changes are free while it’s valid. Buy in the m.Ticket or Trafi app, or just tap your contactless bank card on the validator on board.",
					)}
				</small>
				<span className="ticket-links">
					<a href="https://www.trafi.com/" target="_blank" rel="noreferrer">
						{"Trafi"} <ExternalLink size={12} />
					</a>
					<a
						href="https://judu.lt/viesojo-transporto-keleiviams/bilietu-rusys-ir-kainos-3/"
						target="_blank"
						rel="noreferrer"
					>
						{t("All JUDU tickets")} <ExternalLink size={12} />
					</a>
				</span>
			</div>
		</div>
	);
}

/** Keep shared routes small: at most ~300 points per segment. */
function simplify(coords: [number, number][]) {
	const step = Math.max(1, Math.ceil(coords.length / 300));
	return coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
}

type ActiveShare = {
	shareId: string;
	writeKey: string;
	url: string;
	/** The trip this share belongs to (option, start and destination). */
	trip: string;
};
const SHARE_KEY = "movesmart-live-share";

/**
 * Share the trip live: friends open a page that shows the route, the bus and where you are
 * now, until you arrive or stop. Falls back to a route-only link without a backend.
 */
function LiveShare({
	tripKey,
	option,
	from,
	to,
	when,
	path,
	legs,
}: {
	tripKey: string;
	option: RankedOption;
	from: Place;
	to: Place;
	when: { mode: "now" | "depart" | "arrive"; at: number };
	path: () => PlanPath | null;
	legs: LiveShareInput["legs"];
}) {
	const account = useAccount();
	const t = useT();
	const [asking, setAsking] = useState(false);
	const [share, setShare] = useState<ActiveShare | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	// Resume this trip's share after a reload; a share left over from a different trip is
	// stopped, so friends never keep watching an old route.
	// biome-ignore lint/correctness/useExhaustiveDependencies: check once per trip.
	useEffect(() => {
		let saved: ActiveShare | null = null;
		try {
			saved = JSON.parse(sessionStorage.getItem(SHARE_KEY) ?? "null");
		} catch {}
		if (!saved) return;
		if (saved.trip === tripKey) setShare(saved);
		else {
			void account.liveShare.stop(saved).catch(() => {});
			try {
				sessionStorage.removeItem(SHARE_KEY);
			} catch {}
			setShare(null);
		}
	}, [tripKey]);
	// Send the position while sharing; the page must stay open (no background tracking).
	useEffect(() => {
		if (!share || !navigator.geolocation) return;
		let last = 0;
		const watch = navigator.geolocation.watchPosition(
			async (pos) => {
				if (Date.now() - last < 8_000) return;
				last = Date.now();
				const ok = await account.liveShare
					.update(share, {
						lat: pos.coords.latitude,
						lon: pos.coords.longitude,
						accuracy: pos.coords.accuracy,
					})
					.catch(() => true);
				if (!ok) end();
			},
			() =>
				setNote(
					t(
						"Location is off — your friend still sees your route and your bus live.",
					),
				),
			{ enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
		);
		return () => navigator.geolocation.clearWatch(watch);
		// biome-ignore lint/correctness/useExhaustiveDependencies: restart only for a new share.
	}, [share?.shareId]);
	function end() {
		try {
			sessionStorage.removeItem(SHARE_KEY);
		} catch {}
		setShare(null);
	}
	async function send(url: string, text: string) {
		try {
			if (navigator.share) {
				await navigator.share({ title: "My trip · MoveSmart", text, url });
				return;
			}
			await navigator.clipboard.writeText(`${text} ${url}`);
			setCopied(true);
			setTimeout(() => setCopied(false), 2500);
		} catch {
			// The share sheet was closed.
		}
	}
	const summary = `${option.label}, arriving ${time.format(option.arriveAt)}`;
	async function start() {
		setAsking(false);
		const drawn = path();
		// Only the fields the backend accepts: saved places carry extras like a use count.
		const pick = (p: Place) => ({
			name: p.name || "Place",
			lat: p.lat,
			lon: p.lon,
		});
		const created = await account.liveShare
			.start({
				from: pick(from),
				to: pick(to),
				label: option.label,
				mode: option.mode,
				departAt: option.departAt,
				arriveAt: option.arriveAt,
				legs,
				path: (drawn?.segments ?? [])
					.filter((s) => s.coordinates.length > 1)
					.map((s) => ({ ...s, coordinates: simplify(s.coordinates) })),
			})
			.catch((error) => {
				console.error("Live sharing failed", error);
				return null;
			});
		if (!created) {
			setNote(t("Couldn’t start live sharing. Try again in a moment."));
			return;
		}
		const active = {
			...created,
			url: `${window.location.origin}/trip/${created.shareId}`,
			trip: tripKey,
		};
		try {
			sessionStorage.setItem(SHARE_KEY, JSON.stringify(active));
		} catch {}
		setShare(active);
		await send(active.url, `Follow my trip live to ${to.name}: ${summary}.`);
	}
	function routeLink() {
		const place = (p: Place) =>
			`${p.lat.toFixed(5)},${p.lon.toFixed(5)},${encodeURIComponent(p.name)}`;
		const url = new URL("/", window.location.origin);
		url.searchParams.set("to", place(to));
		url.searchParams.set("from", place(from));
		if (when.mode !== "now") {
			url.searchParams.set("when", when.mode);
			url.searchParams.set("at", String(when.at));
		}
		return url.href;
	}
	if (share)
		return (
			<div className="live-share active" role="status">
				<span className="live-dot" />
				<div>
					<strong>{t("Sharing your trip live")}</strong>
					<small>
						{note ??
							t("Anyone with the link sees where you are until you stop.")}
					</small>
				</div>
				<button
					type="button"
					onClick={() => send(share.url, `Follow my trip live to ${to.name}.`)}
				>
					<Share2 size={14} />
					{t(copied ? "Copied" : "Link")}
				</button>
				<button
					type="button"
					className="stop"
					onClick={async () => {
						await account.liveShare.stop(share).catch(() => {});
						end();
					}}
				>
					{t("Stop")}
				</button>
			</div>
		);
	return (
		<div className="live-share">
			{asking ? (
				<div className="live-share-consent">
					<strong>{t("Share your trip live?")}</strong>
					<p>
						{t(
							"Anyone with the link sees your route, your bus and your live location — until you arrive or tap Stop. Keep this page open while you travel.",
						)}
					</p>
					<div>
						<button type="button" className="primary" onClick={start}>
							{t("Start sharing")}
						</button>
						<button
							type="button"
							onClick={() => {
								setAsking(false);
								void send(routeLink(), `My trip to ${to.name}: ${summary}.`);
							}}
						>
							{t("Just send the route")}
						</button>
					</div>
				</div>
			) : (
				<button
					type="button"
					className="share-trip"
					onClick={() =>
						account.enabled
							? setAsking(true)
							: void send(routeLink(), `My trip to ${to.name}: ${summary}.`)
					}
				>
					<Share2 size={15} />
					{t(
						account.enabled
							? "Share live trip"
							: copied
								? "Link copied"
								: "Share this trip",
					)}
				</button>
			)}
			{note && !share && <p className="helper-text">{note}</p>}
		</div>
	);
}

function DemoSuitability({ option }: { option: RankedOption }) {
	const t = useT();
	const data = option.demoAccess;
	if (!data) return null;
	return (
		<span className="demo-suitability">
			<strong>{t("Demo")}</strong>
			<span>{t(`Bus occupancy: ${data.occupancy}%`)}</span>
			<span>
				{t(
					data.stepFree
						? "Demo: step-free boarding"
						: "Demo: boarding requires steps",
				)}
			</span>
			<span>
				{t(
					data.strollerSpace
						? "Demo: stroller space available"
						: "Demo: no stroller space",
				)}
			</span>
		</span>
	);
}
