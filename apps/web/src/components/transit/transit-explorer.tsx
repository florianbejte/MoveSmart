"use client";

import {
	ArrowLeft,
	ArrowUpRight,
	BusFront,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Clock3,
	Layers2,
	LocateFixed,
	Map as MapIcon,
	MapPin,
	MessageCirclePlus,
	Navigation,
	Radio,
	RefreshCw,
	Route,
	Search,
	SlidersHorizontal,
	Star,
	X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/react";
import { DEFAULT_PROFILE } from "@/lib/plan/profile";
import { communityFeatures } from "@/lib/reports/map";
import type { ReportsFeed } from "@/lib/reports/types";
import { distance, freshVehicle, localParts } from "@/lib/transit/core";
import { SERVICE_COLORS, serviceColor } from "@/lib/transit/service-colors";
import type {
	LiveFeed,
	Network,
	Position,
	Stop,
	StopBoard,
	TransitRoute,
	TripDetail,
	Vehicle,
} from "@/lib/transit/types";
import { useAccount } from "../account";
import { CityLayers, useCityLayers } from "./city-layers";
import {
	ConfirmReport,
	DepartureCrowding,
	FavouriteButton,
	reportForDeparture,
	SavedPanel,
	StopCommunity,
	StopReportDialog,
	useFavourites,
} from "./community-tools";
import { CrowdingCard, CrowdingReport } from "./crowding-report";
import { MapSymbol } from "./map-symbol";
import { Onboarding } from "./onboarding";
import { type PlanPath, TripPlanner } from "./trip-planner";
import { useTransit } from "./use-transit";
import { Welcome } from "./welcome";
import "./transit.css";

const TransitMap = dynamic(() => import("./transit-map"), {
	ssr: false,
	loading: () => (
		<div className="map-loading">
			<RefreshCw className="spin" size={24} />
			<span>{t("Opening Vilnius…")}</span>
		</div>
	),
});
const EMPTY_STOPS: Stop[] = [];
const EMPTY_VEHICLES: Vehicle[] = [];
const timeFormat = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Vilnius",
	hour: "2-digit",
	minute: "2-digit",
});
const normalise = (s: string) =>
	s
		.toLocaleLowerCase("lt")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
function metres(m: number) {
	return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
function RouteBadge({
	route,
	label,
}: {
	route?: TransitRoute;
	label?: string;
}) {
	const t = useT();

	return (
		<span
			className="route-badge"
			style={{
				background: serviceColor(
					route?.name ?? label ?? "",
					route?.mode,
					route?.color,
				),
				color: "white",
			}}
		>
			{t(route?.name ?? label ?? "—")}
		</span>
	);
}

export default function TransitExplorer() {
	const t = useT();

	const network = useTransit<Network>("/api/transit?kind=network", 300_000);
	const live = useTransit<LiveFeed>("/api/transit?kind=vehicles");
	const [query, setQuery] = useState("");
	const reports = useTransit<ReportsFeed>("/api/reports", 30000);
	const [reportTarget, setReportTarget] = useState<{
		vehicle?: Vehicle;
	} | null>(null);
	const favourites = useFavourites();
	const [savedOpen, setSavedOpen] = useState(false);
	const [stopReport, setStopReport] = useState<Stop | null>(null);
	const [communityEnabled, setCommunityEnabled] = useState(true);
	const [mode, setMode] = useState<"all" | "bus" | "trolleybus">("all");
	const [routeId, setRouteId] = useState("");
	const [nearbyOnly, setNearbyOnly] = useState(false);
	const [location, setLocation] = useState<Position | null>(null);
	const [locating, setLocating] = useState(false);
	const [locationError, setLocationError] = useState<string | null>(null);
	const [center, setCenter] = useState<Position>({
		lat: 54.6872,
		lon: 25.2797,
	});
	const [focus, setFocus] = useState<(Position & { key: number }) | null>(null);
	const [selection, setSelection] = useState<{
		type: "stop" | "vehicle";
		id: string;
	} | null>(null);
	const panelContent = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new selection must start at the top of its detail panel.
	useEffect(() => {
		panelContent.current?.scrollTo({ top: 0 });
	}, [selection?.id, selection?.type]);
	const [now, setNow] = useState(Date.now());
	const city = useCityLayers(now);
	const [cityOpen, setCityOpen] = useState(false);
	// The app opens on "where to?"; the map appears once a way is chosen.
	const [planOpen, setPlanOpen] = useState(true);
	const [planStage, setPlanStage] = useState<"choose" | "map">("choose");
	useEffect(() => {
		if (planStage === "map") setSheet("half");
	}, [planStage]);
	const account = useAccount();
	const profile = account.profile;
	const [editingProfile, setEditingProfile] = useState(false);
	const [guestChosen, setGuestChosen] = useState(false);
	const [planPath, setPlanPath] = useState<PlanPath | null>(null);
	// While following a chosen trip, the map shows only that trip: your buses and their stops.
	const tripFocus = planOpen && planStage === "map" && !!planPath;
	const tripVehicles = useMemo(() => {
		const rides = planPath?.rides;
		if (!tripFocus || !rides?.length) return EMPTY_VEHICLES;
		const all = live.data?.vehicles ?? EMPTY_VEHICLES;
		// Your exact bus if it's running; otherwise that route's buses, so you can see one coming.
		return rides.flatMap((ride) => {
			const own = all.filter((v) => v.tripId === ride.tripId);
			return own.length ? own : all.filter((v) => v.routeId === ride.routeId);
		});
	}, [tripFocus, planPath, live.data]);
	const tripStops = useMemo(
		() =>
			tripFocus && planPath?.stopIds?.length
				? (network.data?.stops ?? EMPTY_STOPS).filter((s) =>
						planPath.stopIds?.includes(s.id),
					)
				: EMPTY_STOPS,
		[tripFocus, planPath, network.data],
	);
	useEffect(() => {
		try {
			setGuestChosen(sessionStorage.getItem("movesmart-guest") === "1");
		} catch {}
	}, []);
	// Signed-out visitors see the welcome screen; anyone without a profile does the questionnaire.
	const welcome = account.enabled && account.status === "guest" && !guestChosen;
	const onboarding =
		editingProfile ||
		(!welcome && account.status !== "loading" && profile === null);
	// Returning users with a profile land straight on "where to?".
	const landed = useRef(false);
	useEffect(() => {
		if (landed.current || !profile || account.status !== "signed-in") return;
		landed.current = true;
		setPlanOpen(true);
	}, [profile, account.status]);
	const [sheet, setSheet] = useState<"peek" | "half" | "full">("half");
	const [filtersOpen, setFiltersOpen] = useState(false);
	const sheetPointer = useRef<number | null>(null);
	const sheetSwiped = useRef(false);
	function openSaved() {
		setSavedOpen(true);
		setPlanOpen(false);
		setCityOpen(false);
		setSelection(null);
		setPreviewTrip(null);
		setFiltersOpen(false);
		setQuery("");
		setSheet("half");
		panelContent.current?.scrollTo({ top: 0 });
	}
	function openNearby() {
		setSavedOpen(false);
		setSelection(null);
		setPreviewTrip(null);
		setCityOpen(false);
		setPlanOpen(false);
		setSheet("half");
	}
	function openPlan() {
		setSavedOpen(false);
		setPlanOpen(true);
		setCityOpen(false);
		setSelection(null);
		setSheet(sheet === "peek" ? "half" : sheet);
		panelContent.current?.scrollTo({ top: 0 });
	}
	function openLayers() {
		setSavedOpen(false);
		setCityOpen(true);
		setPlanOpen(false);
		setSheet("half");
		panelContent.current?.scrollTo({ top: 0 });
	}

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 10_000);
		return () => clearInterval(timer);
	}, []);
	const routes = network.data?.routes ?? [];
	const stops = network.data?.stops ?? EMPTY_STOPS;
	const vehicles = live.data?.vehicles ?? EMPTY_VEHICLES;
	const origin = location ?? center;
	const community = useMemo(
		() =>
			communityFeatures(
				communityEnabled && !reports.error ? reports.data : undefined,
				stops,
				vehicles,
				now,
			),
		[communityEnabled, reports.error, reports.data, stops, vehicles, now],
	);
	const routeById = useMemo(
		() => new Map(network.data?.routes.map((r) => [r.id, r]) ?? []),
		[network.data],
	);
	const selectedVehicle =
		selection?.type === "vehicle"
			? vehicles.find((v) => v.id === selection.id)
			: undefined;
	const selectedStop =
		selection?.type === "stop"
			? stops.find((s) => s.id === selection.id)
			: undefined;
	const [previewTrip, setPreviewTrip] = useState<string | null>(null);
	const tripId = selectedVehicle?.tripId ?? previewTrip;
	const trip = useTransit<TripDetail>(
		tripId ? `/api/transit?kind=trip&id=${encodeURIComponent(tripId)}` : null,
		300_000,
	);
	const board = useTransit<StopBoard>(
		selection?.type === "stop"
			? `/api/transit?kind=stop&id=${encodeURIComponent(selection.id)}`
			: null,
	);
	const stopRoutes = useTransit<{
		stopId: string;
		trips: TripDetail[];
		stale: boolean;
	}>(
		selectedStop
			? `/api/transit?kind=stop-routes&id=${encodeURIComponent(selectedStop.id)}`
			: null,
		300000,
	);
	const needle = normalise(query.trim());
	const filteredVehicles = useMemo(
		() =>
			vehicles.filter(
				(v) =>
					(mode === "all" || v.mode === mode) &&
					(!routeId || v.routeId === routeId) &&
					(!needle ||
						normalise(`${v.route} ${v.destination}`).includes(needle)) &&
					(!nearbyOnly || distance(origin, v) <= 2000),
			),
		[vehicles, mode, routeId, needle, nearbyOnly, origin],
	);
	const filteredStops = useMemo(
		() =>
			stops.filter(
				(s) =>
					(!nearbyOnly || distance(origin, s) <= 2000) &&
					(!routeId || s.routeIds.includes(routeId)) &&
					(mode === "all" ||
						s.routeIds.some((id) => routeById.get(id)?.mode === mode)) &&
					(!needle ||
						normalise(s.name).includes(needle) ||
						s.routeIds.some((id) =>
							normalise(routeById.get(id)?.name ?? "").includes(needle),
						)),
			),
		[stops, mode, routeId, routeById, needle, nearbyOnly, origin],
	);
	const nearbyStops = useMemo(
		() =>
			filteredStops
				.map((stop) => ({ stop, distance: distance(origin, stop) }))
				.sort((a, b) => a.distance - b.distance)
				.slice(0, 12),
		[filteredStops, origin],
	);
	const nearbyVehicles = useMemo(
		() =>
			filteredVehicles
				.map((vehicle) => ({ vehicle, distance: distance(origin, vehicle) }))
				.sort((a, b) => a.distance - b.distance)
				.slice(0, 8),
		[filteredVehicles, origin],
	);
	const freshCount = vehicles.filter((v) => freshVehicle(v, now)).length;
	const feedStale =
		!!live.error ||
		!!live.data?.stale ||
		(!!live.data && now - live.data.sourceUpdatedAt > 120_000);
	const selectedFresh =
		selectedVehicle && freshVehicle(selectedVehicle, now) && !feedStale;
	function focusOn(position: Position) {
		setFocus({ ...position, key: Date.now() });
	}
	function selectStop(id: string) {
		setPlanOpen(false);
		setSavedOpen(false);
		setSheet("half");
		setFiltersOpen(false);
		setCityOpen(false);
		setQuery("");
		setSelection({ type: "stop", id });
		setPreviewTrip(null);
		const stop = stops.find((s) => s.id === id);
		if (stop) focusOn(stop);
	}
	function selectVehicle(id: string) {
		setPlanOpen(false);
		setSavedOpen(false);
		setSheet("half");
		setFiltersOpen(false);
		setCityOpen(false);
		setQuery("");
		setSelection({ type: "vehicle", id });
		setPreviewTrip(null);
		const vehicle = vehicles.find((v) => v.id === id);
		if (vehicle) focusOn(vehicle);
	}
	// If location was allowed before, use it straight away (no prompt, no map jump), so trips
	// start from where the rider is instead of the city centre.
	useEffect(() => {
		if (!navigator.geolocation || !navigator.permissions) return;
		let cancelled = false;
		navigator.permissions
			.query({ name: "geolocation" })
			.then((status) => {
				if (cancelled || status.state !== "granted") return;
				navigator.geolocation.getCurrentPosition(
					(position) => {
						const point = {
							lat: position.coords.latitude,
							lon: position.coords.longitude,
						};
						// Outside Vilnius the city centre is a more useful start.
						if (
							!cancelled &&
							distance(point, { lat: 54.6872, lon: 25.2797 }) <= 60_000
						)
							setLocation((current) => current ?? point);
					},
					() => {},
					{ enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
				);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);
	function locate() {
		setSheet("half");
		setCityOpen(false);
		panelContent.current?.scrollTo({ top: 0 });
		if (!navigator.geolocation) {
			setLocationError(
				"Location is not supported in this browser. You can search for a stop or move the map instead.",
			);
			return;
		}
		setLocating(true);
		setLocationError(null);
		navigator.geolocation.getCurrentPosition(
			(position) => {
				const point = {
					lat: position.coords.latitude,
					lon: position.coords.longitude,
				};
				setLocation(point);
				setLocating(false);
				if (distance(point, { lat: 54.6872, lon: 25.2797 }) > 60_000) {
					setLocationError(
						"You appear to be outside the Vilnius service area. Distances use your location; the map stays in Vilnius.",
					);
				} else {
					focusOn(point);
					setNearbyOnly(true);
				}
			},
			(error) => {
				setLocating(false);
				setLocationError(
					error.code === 1
						? "Location permission was declined. Search for a stop or move the map to explore nearby services."
						: "We couldn’t find your location. Try again, or move the map to your area.",
				);
			},
			{ enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
		);
	}
	const resetFilters = () => {
		setQuery("");
		setMode("all");
		setRouteId("");
		setNearbyOnly(false);
	};
	return (
		<main
			className="transit-app"
			data-sheet={sheet}
			data-view={planOpen ? "plan" : cityOpen ? "layers" : "nearby"}
			data-detail={!!selection && !cityOpen && !planOpen}
			data-stage={planOpen ? planStage : "map"}
		>
			<aside className="explorer-panel" aria-label={t("Transit explorer")}>
				<button
					type="button"
					className="sheet-handle"
					aria-label={t(
						sheet === "full" ? "Show more map" : "Expand transit panel",
					)}
					aria-expanded={sheet === "full"}
					onClick={() => {
						if (sheetSwiped.current) {
							sheetSwiped.current = false;
							return;
						}
						setSheet(sheet === "full" ? "half" : "full");
					}}
					onPointerDown={(e) => {
						sheetPointer.current = e.clientY;
						sheetSwiped.current = false;
						e.currentTarget.setPointerCapture(e.pointerId);
					}}
					onPointerUp={(e) => {
						if (sheetPointer.current !== null) {
							const delta = e.clientY - sheetPointer.current;
							if (Math.abs(delta) > 25) {
								sheetSwiped.current = true;
								setSheet(
									delta < 0 ? "full" : sheet === "full" ? "half" : "peek",
								);
							}
							sheetPointer.current = null;
						}
					}}
					onPointerCancel={() => {
						sheetPointer.current = null;
					}}
				>
					<span />
				</button>
				<div className="explorer-heading">
					<div>
						<h1>
							{t(
								planOpen
									? "Let’s get there."
									: cityOpen
										? "A closer look."
										: savedOpen
											? "Saved places."
											: "Find your ride.",
							)}
						</h1>
						<p>
							{t(
								planOpen
									? "Bus, bike, walk or car — ranked for you."
									: cityOpen
										? "The city, layer by layer."
										: savedOpen
											? "Your everyday journeys, one tap away."
											: "Vilnius is moving. Come along.",
							)}
						</p>
					</div>
					<button
						type="button"
						className="sheet-size-button"
						aria-label={t(
							sheet === "full" ? "Show more map" : "Expand transit panel",
						)}
						onClick={() => setSheet(sheet === "full" ? "half" : "full")}
					>
						{sheet === "full" ? (
							<ChevronDown size={20} />
						) : (
							<ChevronUp size={20} />
						)}
					</button>
					<span className="heading-route-symbol" aria-hidden="true">
						<BusFront size={25} />
					</span>
				</div>
				<label className="transit-search" hidden={savedOpen}>
					<Search size={19} />
					<input
						value={query}
						onFocus={() => {
							setCityOpen(false);
							setSheet("full");
						}}
						onChange={(e) => {
							setQuery(e.target.value);
							setSelection(null);
							setPreviewTrip(null);
						}}
						placeholder={t("Stop, route or destination")}
						aria-label={t("Search stops, routes or destinations")}
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							aria-label={t("Clear search")}
						>
							<X size={16} />
						</button>
					)}
					<button
						type="button"
						className={`filter-button ${filtersOpen || routeId || mode !== "all" || nearbyOnly ? "active" : ""}`}
						aria-label={t("Route filters")}
						aria-expanded={filtersOpen}
						onClick={() => {
							setFiltersOpen(!filtersOpen);
							setCityOpen(false);
							if (sheet === "peek") setSheet("half");
						}}
					>
						<SlidersHorizontal size={19} />
					</button>
				</label>
				<nav className="panel-tabs" aria-label={t("Explore views")}>
					<button
						type="button"
						aria-pressed={!cityOpen && !planOpen && !savedOpen}
						onClick={openNearby}
					>
						<MapPin size={16} />
						{t("Nearby")}
					</button>
					<button type="button" aria-pressed={planOpen} onClick={openPlan}>
						<Route size={16} />
						{t("Plan")}
					</button>
					<button type="button" aria-pressed={cityOpen} onClick={openLayers}>
						<Layers2 size={16} />
						{t("Layers")}
						<span className="layer-count">{t(city.enabled.length)}</span>
					</button>
					<button type="button" aria-pressed={savedOpen} onClick={openSaved}>
						<Star size={16} />
						{t("Saved")}
					</button>
				</nav>
				<div className="panel-content" ref={panelContent}>
					<div
						className="explorer-filters"
						hidden={!filtersOpen || cityOpen || planOpen}
					>
						<fieldset className="mode-tabs" aria-label={t("Transport type")}>
							{(
								[
									["all", "All transport"],
									["bus", "Buses"],
									["trolleybus", "Trolleybuses"],
								] as const
							).map(([value, label]) => (
								<button
									type="button"
									key={value}
									className={mode === value ? "active" : ""}
									aria-pressed={mode === value}
									onClick={() => {
										setMode(value);
										setRouteId("");
									}}
								>
									{t(label)}
								</button>
							))}
						</fieldset>
						<div className="filter-row">
							<label className="route-select">
								<span className="sr-only">{t("Filter by route")}</span>
								<select
									value={routeId}
									onChange={(e) => setRouteId(e.target.value)}
								>
									<option value="">{t("Every route")}</option>
									{routes
										.filter((r) => mode === "all" || r.mode === mode)
										.map((r) => (
											<option key={r.id} value={r.id}>
												{t(r.name)} ·{t(" ")}
												{t(r.mode === "trolleybus" ? "Trolleybus" : "Bus")}
											</option>
										))}
								</select>
							</label>
							{routeId && (
								<FavouriteButton
									active={favourites.saved.routes.includes(routeId)}
									onClick={() => favourites.toggle("routes", routeId)}
									label={t("route")}
								/>
							)}
							<button
								type="button"
								className={`nearby-toggle ${nearbyOnly ? "active" : ""}`}
								aria-pressed={nearbyOnly}
								onClick={() => setNearbyOnly((v) => !v)}
							>
								<Navigation size={14} />
								{t("Within 2 km")}
							</button>
						</div>
						<button
							type="button"
							className="locate-button"
							onClick={locate}
							disabled={locating}
						>
							<LocateFixed size={18} className={locating ? "spin" : ""} />
							<span>
								{t(
									locating
										? "Finding your location…"
										: location
											? "Update my location"
											: "Use my location",
								)}
							</span>
							<ArrowUpRight size={17} />
						</button>
					</div>
					{locationError && (
						<div className="notice location-notice" role="status">
							<span>{t(locationError)}</span>
							<button
								type="button"
								aria-label={t("Dismiss location message")}
								onClick={() => setLocationError(null)}
							>
								<X size={16} />
							</button>
						</div>
					)}
					{location && (
						<button
							type="button"
							className="text-button"
							onClick={() => {
								setLocation(null);
								setNearbyOnly(false);
								setLocationError(null);
							}}
						>
							{t("Use map center instead")}
						</button>
					)}
					{(network.error || live.error || network.data?.stale) && (
						<div className="notice warning" role="status">
							{t(
								network.error ||
									live.error ||
									"Using a saved timetable while the source reconnects.",
							)}
							<button
								type="button"
								onClick={() => {
									network.retry();
									live.retry();
								}}
							>
								<RefreshCw size={14} />
								{t("Retry")}
							</button>
						</div>
					)}
					{cityOpen && (
						<section className="community-layer-control">
							<label>
								<input
									type="checkbox"
									checked={communityEnabled}
									onChange={(e) => setCommunityEnabled(e.target.checked)}
								/>
								<MapSymbol kind="community" color="#7343aa" />
								{t("Community reports · ")}
								{t(community.features.length)}
							</label>
							<p>{t("Rider observations · tap purple markers to read.")}</p>
							{reports.error && (
								<p role="status">
									{t("Community reports unavailable.")}
									{t(" ")}
									<button type="button" onClick={reports.retry}>
										{t("Retry")}
									</button>
								</p>
							)}
						</section>
					)}
					{favourites.error && <p role="status">{t(favourites.error)}</p>}
					<div hidden={planOpen || savedOpen}>
						<CityLayers
							city={city}
							now={now}
							open={cityOpen}
							onOpen={setCityOpen}
							routeNames={
								selectedVehicle
									? [selectedVehicle.route]
									: selectedStop
										? selectedStop.routeIds.map(
												(id) => routeById.get(id)?.name ?? "",
											)
										: routeId
											? [routeById.get(routeId)?.name ?? ""]
											: []
							}
						/>
					</div>
					<div
						className="transit-results"
						hidden={cityOpen || planOpen}
						key={selection?.id ?? "nearby"}
					>
						{selection && (
							<button
								className="back-button"
								type="button"
								onClick={() => {
									setSelection(null);
									setPreviewTrip(null);
								}}
							>
								<ArrowLeft size={15} />
								{t("Back to nearby")}
							</button>
						)}
						{selection?.type === "stop" ? (
							<>
								<div className="detail-heading">
									<span className="detail-icon">
										<MapPin size={23} />
									</span>
									<div>
										<span className="eyebrow">
											{t("Stop ")}
											{t(selectedStop?.id ?? selection.id)}
										</span>
										<h2>{t(selectedStop?.name ?? "Loading stop…")}</h2>
										<p>
											{t(
												selectedStop?.description ||
													"Departures from this platform",
											)}
										</p>
									</div>
								</div>
								{selectedStop && (
									<FavouriteButton
										active={favourites.saved.stops.includes(selectedStop.id)}
										onClick={() => favourites.toggle("stops", selectedStop.id)}
										label="stop"
									/>
								)}

								<details className="stop-more-info">
									<summary>{t("Stop information & community")}</summary>
									{t(" ")}
									{selectedStop && (
										<StopCommunity
											stop={selectedStop}
											issues={reports.error ? [] : (reports.data?.issues ?? [])}
											now={now}
											onReport={() => setStopReport(selectedStop)}
											onRefresh={reports.retry}
											unavailable={!!reports.error}
										/>
									)}
									{selectedStop && (
										<p className="helper-text" role="status">
											{t(
												stopRoutes.error
													? "Route outlines unavailable. Try again."
													: !stopRoutes.data
														? "Loading routes from this stop…"
														: `${stopRoutes.data.stale ? "Cached timetable · " : ""}Showing routes from this platform. Check departures for service times.`,
											)}
											{stopRoutes.error && (
												<button type="button" onClick={stopRoutes.retry}>
													{t("Retry")}
												</button>
											)}
										</p>
									)}
								</details>
								<div className="stop-route-list">
									{selectedStop?.routeIds.map((id) => (
										<RouteBadge key={id} route={routeById.get(id)} />
									))}
								</div>
								<div className="section-heading">
									<h3>{t("Upcoming departures")}</h3>
									<span>{t("Vilnius time")}</span>
								</div>
								<details className="departure-explanation">
									<summary>{t("About arrival times")}</summary>
									<p className="helper-text">
										{t(
											"Live estimates use reported schedule deviation. Scheduled times appear when live data is unavailable.",
										)}
									</p>
								</details>
								{board.error && (
									<div className="notice warning" role="status">
										{t(
											"Couldn’t refresh departures. Any previous estimates may be outdated.",
										)}
										<button type="button" onClick={board.retry}>
											{t("Try again")}
										</button>
									</div>
								)}
								{!board.data && !board.error && (
									<p className="loading-text">{t("Loading departures…")}</p>
								)}
								{board.data?.stale && (
									<p className="notice">
										{t(
											"Some sources are unavailable; times may be scheduled or based on a saved timetable.",
										)}
									</p>
								)}
								{board.data?.departures
									.filter((d) => d.estimatedAt >= now)
									.slice(0, 20)
									.map((d) => {
										const crowding = !reports.error
											? reportForDeparture(reports.data?.reports ?? [], d, now)
											: undefined;
										const isLive =
											d.live &&
											!board.error &&
											now - (board.data?.generatedAt ?? 0) < 120_000;
										return (
											<button
												type="button"
												className="departure-row"
												key={`${d.tripId}-${d.scheduledAt}`}
												onClick={() => {
													if (
														d.vehicleId &&
														vehicles.some((v) => v.id === d.vehicleId)
													)
														selectVehicle(d.vehicleId);
													else setPreviewTrip(d.tripId);
												}}
											>
												<RouteBadge route={routeById.get(d.routeId)} />
												<span className="row-main">
													<strong>{t(d.destination)}</strong>
													<small>
														{t(
															isLive
																? "Live estimate"
																: d.live
																	? "Last estimate · outdated"
																	: "Scheduled",
														)}
														{t(" ")}· {t(timeFormat.format(d.scheduledAt))}
													</small>
													{isLive && (
														<DepartureCrowding report={crowding} now={now} />
													)}
												</span>
												<span
													className={`departure-time ${isLive ? "live" : ""}`}
												>
													<strong>
														{t(
															Math.max(
																1,
																Math.ceil((d.estimatedAt - now) / 60_000),
															),
														)}
														<small>{t(" min")}</small>
													</strong>
													{isLive && <Radio size={12} />}
												</span>
											</button>
										);
									})}
								{board.data &&
									!board.data.departures.some((d) => d.estimatedAt >= now) && (
										<div className="empty-state">
											<Clock3 size={25} />
											<h3>{t("No upcoming departures")}</h3>
											<p>
												{t(
													"No boarding services are scheduled here in the next 24 hours.",
												)}
											</p>
										</div>
									)}

								{previewTrip && (
									<p className="helper-text">
										{t("Selected departure’s route is highlighted on the map.")}
									</p>
								)}
							</>
						) : selection?.type === "vehicle" ? (
							selectedVehicle ? (
								<>
									<div className="detail-heading">
										<RouteBadge
											route={
												selectedVehicle.routeId
													? routeById.get(selectedVehicle.routeId)
													: undefined
											}
											label={t(selectedVehicle.route)}
										/>
										<div>
											<span className="eyebrow">
												{t(
													selectedVehicle.mode === "bus" ? "Bus" : "Trolleybus",
												)}
												{t(" ")}· {t(selectedVehicle.number)}
											</span>
											<h2>
												{t(
													selectedVehicle.destination ||
														"Destination unavailable",
												)}
											</h2>
										</div>
									</div>
									<CrowdingCard
										report={
											!reports.error
												? reports.data?.reports.find(
														(r) =>
															r.vehicleId === selectedVehicle.id &&
															r.tripId ===
																`${localParts(now).date}:${selectedVehicle.tripId}` &&
															r.expiresAt > now,
													)
												: undefined
										}
										unavailable={!!reports.error}
										onReport={() =>
											setReportTarget({ vehicle: selectedVehicle })
										}
									/>
									{selectedVehicle.routeId && (
										<FavouriteButton
											active={favourites.saved.routes.includes(
												selectedVehicle.routeId,
											)}
											onClick={() =>
												favourites.toggle(
													"routes",
													selectedVehicle.routeId as string,
												)
											}
											label={`route ${selectedVehicle.route}`}
										/>
									)}
									{reports.data?.reports
										.filter(
											(r) =>
												!reports.error &&
												r.vehicleId === selectedVehicle.id &&
												r.tripId ===
													`${localParts(now).date}:${selectedVehicle.tripId}` &&
												r.expiresAt > now,
										)
										.map((r) => (
											<ConfirmReport
												key={`${r.vehicleId}:${r.tripId}:${r.level}`}
												disabled={!selectedFresh}
												body={{
													vehicleId: r.vehicleId,
													tripId: selectedVehicle.tripId,
													level: r.level,
													confirm: true,
												}}
												onDone={reports.retry}
											/>
										))}
									<details className="vehicle-service-details">
										<summary>{t("Vehicle & service details")}</summary>
										<div className="vehicle-metrics">
											<div>
												<span>{t("Speed")}</span>
												<strong>
													{t(selectedVehicle.speed)}
													<small> km/h</small>
												</strong>
											</div>
											<div>
												<span>{t("Schedule deviation")}</span>
												<strong>
													{t(
														!selectedFresh || selectedVehicle.delay === null
															? "Unknown"
															: Math.abs(selectedVehicle.delay) < 60
																? "On time"
																: `${Math.round(Math.abs(selectedVehicle.delay) / 60)} min ${selectedVehicle.delay > 0 ? "late" : "early"}`,
													)}
												</strong>
											</div>
										</div>
									</details>
									<p
										className={`vehicle-update ${selectedFresh ? "" : "warning"}`}
									>
										<span
											className={`status-dot ${selectedFresh ? "" : "offline"}`}
										/>
										{t(selectedFresh ? "Live position" : "Last known position")}
										{t(" ")}·{t(" ")}
										{t(
											Math.max(
												0,
												Math.floor((now - selectedVehicle.measuredAt) / 1000),
											),
										)}
										{t("s ago")}
									</p>
									<button
										className="locate-button secondary"
										type="button"
										onClick={() => focusOn(selectedVehicle)}
									>
										<Navigation size={16} />
										{t("Center on this vehicle")}
									</button>
									<div className="section-heading">
										<h3>{t("Stops on this trip")}</h3>
										<span>
											{t(trip.data?.stops.length ?? "—")}
											{t(" stops")}
										</span>
									</div>
									{!selectedVehicle.tripId && (
										<p className="notice">
											{t(
												"This vehicle has no matching trip information. Its position is still shown.",
											)}
										</p>
									)}
									{selectedVehicle.tripId && !trip.data && !trip.error && (
										<p className="loading-text">{t("Loading route…")}</p>
									)}
									{trip.data?.stops.map((stop, index) => (
										<button
											type="button"
											className="trip-stop"
											key={`${stop.id}-${index}`}
											onClick={() => selectStop(stop.id)}
										>
											<span className="stop-sequence">{t(index + 1)}</span>
											<span>{t(stop.name)}</span>
											<ChevronRight size={15} />
										</button>
									))}
								</>
							) : (
								<div className="empty-state">
									<BusFront size={25} />
									<h3>{t("Vehicle no longer reporting")}</h3>
									<p>
										{t(
											"It may have finished its trip. Choose another vehicle from the map.",
										)}
									</p>
								</div>
							)
						) : savedOpen ? (
							<SavedPanel
								saved={favourites.saved}
								stops={stops}
								routes={routes}
								onStop={selectStop}
								onRoute={(id) => {
									openNearby();
									setRouteId(id);
									setMode("all");
									setQuery("");
									setNearbyOnly(false);
									setFiltersOpen(true);
								}}
								onExplore={openNearby}
								onRemove={favourites.toggle}
							/>
						) : (
							<>
								<div className="section-heading">
									<h2>{t(needle ? "Matching stops" : "Nearby stops")}</h2>
									<span>
										{t(location ? "From your location" : "From map center")}
									</span>
								</div>
								{!network.data && !network.error && (
									<p className="loading-text">
										{t("Loading Vilnius stops and routes…")}
									</p>
								)}
								{nearbyStops.map(({ stop, distance: metresAway }) => (
									<button
										type="button"
										className="stop-card"
										key={stop.id}
										onClick={() => selectStop(stop.id)}
									>
										<span className="stop-card-icon">
											<MapPin size={19} />
										</span>
										<span className="row-main">
											<strong>{t(stop.name)}</strong>
											<small>
												{t(metres(metresAway))}
												{t(" away")}
												{t(stop.description ? ` · ${stop.description}` : "")}
											</small>
											<span className="stop-route-list">
												{stop.routeIds.slice(0, 6).map((id) => (
													<RouteBadge key={id} route={routeById.get(id)} />
												))}
												{stop.routeIds.length > 6 && (
													<span className="more-routes">
														+{t(stop.routeIds.length - 6)}
													</span>
												)}
											</span>
										</span>
										<ChevronRight size={17} />
									</button>
								))}
								{network.data && !nearbyStops.length && (
									<div className="empty-state">
										<Search size={24} />
										<h3>{t("No matching stops")}</h3>
										<p>{t("Try another name or clear the route filters.")}</p>
										<button
											type="button"
											className="text-button"
											onClick={resetFilters}
										>
											{t("Clear filters")}
										</button>
									</div>
								)}
								<div className="section-heading vehicles-heading">
									<h2>{t("Vehicles nearby")}</h2>
									<span>
										{t(filteredVehicles.length)}
										{t(" matching")}
									</span>
								</div>
								{nearbyVehicles.map(({ vehicle, distance: metresAway }) => (
									<button
										className="departure-row"
										type="button"
										key={vehicle.id}
										onClick={() => selectVehicle(vehicle.id)}
									>
										<RouteBadge
											route={
												vehicle.routeId
													? routeById.get(vehicle.routeId)
													: undefined
											}
											label={t(vehicle.route)}
										/>
										<span className="row-main">
											<strong>
												{t(vehicle.destination || "Destination unavailable")}
											</strong>
											<small>
												{t(metres(metresAway))}
												{t(" away ·")}
												{t(" ")}
												{t(
													freshVehicle(vehicle, now) && !feedStale
														? "Live"
														: "Last known position",
												)}
											</small>
										</span>
										<ChevronRight size={15} />
									</button>
								))}
								{live.data && !nearbyVehicles.length && (
									<p className="notice">
										{t("No vehicles match this area or filter right now.")}
										<button type="button" onClick={resetFilters}>
											{t("Show all vehicles")}
										</button>
									</p>
								)}
							</>
						)}
						{trip.error && selection && (
							<div className="notice warning">
								{t("Route details are unavailable.")}
								<button type="button" onClick={trip.retry}>
									{t("Retry route")}
								</button>
							</div>
						)}
					</div>
					<TripPlanner
						hidden={!planOpen}
						vehicles={live.data?.vehicles ?? EMPTY_VEHICLES}
						stops={stops}
						routes={routeById}
						origin={origin}
						usingLocation={!!location}
						locating={locating}
						onLocate={locate}
						profile={profile ?? DEFAULT_PROFILE}
						places={account.places}
						onPlace={account.rememberPlace}
						onPath={setPlanPath}
						onStage={setPlanStage}
						onEditProfile={() => setEditingProfile(true)}
						now={now}
					/>
				</div>
				<footer className="panel-footer">
					<span className={`status-dot ${feedStale ? "offline" : ""}`} />
					<span>
						{t(
							!live.data
								? "Connecting to JUDU…"
								: feedStale
									? "Feed interrupted · showing last update"
									: `${freshCount} vehicles reporting live`,
						)}
					</span>
					<button
						type="button"
						aria-label={t("Refresh vehicle positions")}
						onClick={live.retry}
					>
						<RefreshCw size={14} />
					</button>
				</footer>
			</aside>
			<section className="map-panel" aria-label={t("Map and live vehicles")}>
				<TransitMap
					community={community}
					city={city.collection}
					routes={routes}
					tripColor={serviceColor(
						routeById.get(trip.data?.routeId ?? "")?.name ?? "",
						routeById.get(trip.data?.routeId ?? "")?.mode,
						routeById.get(trip.data?.routeId ?? "")?.color,
					)}
					onCityPin={() => setSheet("peek")}
					cityDelayed={city.enabled.filter((id) => {
						const feed = city.feeds[id];
						return (
							!!feed.error ||
							feed.data?.stale ||
							(!!feed.data &&
								!["parking", "signals", "corridors", "shelters"].includes(id) &&
								now - feed.data.fetchedAt > 120000)
						);
					})}
					stale={feedStale}
					now={now}
					vehicles={
						tripFocus
							? tripVehicles
							: selectedVehicle
								? vehicles.filter((v) =>
										selectedVehicle.routeId
											? v.routeId === selectedVehicle.routeId
											: v.route === selectedVehicle.route &&
												v.mode === selectedVehicle.mode,
									)
								: selectedStop
									? vehicles.filter(
											(v) =>
												v.routeId !== null &&
												selectedStop.routeIds.includes(v.routeId),
										)
									: filteredVehicles
					}
					stops={tripFocus ? tripStops : filteredStops}
					selectedStop={selectedStop}
					trip={trip.data}
					stopTrips={
						selectedStop && !previewTrip ? stopRoutes.data?.trips : undefined
					}
					selectedId={selection?.id}
					location={location}
					focus={focus}
					onVehicle={selectVehicle}
					onStop={selectStop}
					onCenter={setCenter}
					plan={planOpen ? planPath : null}
				/>
				<div className="map-topbar">
					<div className="city-pill">
						<MapPin size={15} />
						<strong>Vilnius</strong>
						<span>{t("Lithuania")}</span>
					</div>
					<div className={`live-pill ${feedStale ? "is-stale" : ""}`}>
						<span className={`status-dot ${feedStale ? "offline" : ""}`} />
						{t(
							!live.data
								? "Connecting"
								: feedStale
									? "Feed delayed"
									: "Live transport",
						)}
					</div>
				</div>
				<div className="map-actions">
					<button
						type="button"
						className="map-report-button"
						aria-label={t("Report bus crowding")}
						onClick={() => setReportTarget({ vehicle: selectedVehicle })}
					>
						<MessageCirclePlus size={22} />
					</button>
					<button
						type="button"
						className="map-location"
						aria-label={t("Find my location")}
						onClick={locate}
						disabled={locating}
					>
						<LocateFixed size={21} className={locating ? "spin" : ""} />
					</button>
					<button
						type="button"
						className="map-layer-button"
						aria-label={t("Open city layers")}
						onClick={openLayers}
					>
						<Layers2 size={20} />
						<span>{t(city.enabled.length)}</span>
					</button>
				</div>
				<div className="map-legend">
					{Object.entries(SERVICE_COLORS).map(([service, color]) => (
						<span key={service}>
							<i style={{ background: color }} />
							{t(
								{
									express: "Express",
									bus: "Bus",
									trolleybus: "Trolley",
									night: "Night",
									river: "River",
								}[service],
							)}
						</span>
					))}
					<span>
						<MapSymbol kind="stop" color="#414454" />
						{t("Stop")}
					</span>
					{city.enabled.includes("shelters") && (
						<span>
							<MapSymbol kind="shelters" color="#a74716" />
							{t("Shelter")}
						</span>
					)}
					<span className="legend-faded">{t("Faded = older position")}</span>
				</div>
				<a
					className="data-credit"
					href="https://judu.lt/kita-informacija/atviri-duomenys/"
					target="_blank"
					rel="noreferrer"
				>
					{t("Transit data: JUDU / stops.lt ↗")}
				</a>
			</section>
			{stopReport && (
				<StopReportDialog
					stop={stopReport}
					vehicles={vehicles}
					now={now}
					onClose={() => setStopReport(null)}
					onSent={reports.retry}
				/>
			)}
			{reportTarget && (
				<CrowdingReport
					initialVehicle={reportTarget.vehicle}
					vehicles={vehicles}
					now={now}
					onClose={() => setReportTarget(null)}
					onSent={(vehicle) => {
						reports.retry();
						selectVehicle(vehicle.id);
					}}
				/>
			)}
			<nav className="mobile-dock" aria-label={t("Map views")}>
				<button
					type="button"
					aria-pressed={sheet === "peek"}
					onClick={() => {
						openNearby();
						setSheet("peek");
					}}
				>
					<MapIcon size={21} />
					<span>{t("Map")}</span>
				</button>
				<button
					type="button"
					aria-pressed={
						sheet !== "peek" && !cityOpen && !planOpen && !savedOpen
					}
					onClick={openNearby}
				>
					<BusFront size={21} />
					<span>{t("Nearby")}</span>
				</button>
				<button
					type="button"
					aria-pressed={sheet !== "peek" && planOpen}
					onClick={openPlan}
				>
					<Route size={21} />
					<span>{t("Plan")}</span>
				</button>
				<button
					type="button"
					aria-pressed={sheet !== "peek" && cityOpen}
					onClick={openLayers}
				>
					<Layers2 size={21} />
					<span>{t("Layers")}</span>
				</button>
				<button
					type="button"
					aria-pressed={sheet !== "peek" && savedOpen}
					onClick={openSaved}
				>
					<Star size={21} />
					<span>{t("Saved")}</span>
				</button>
			</nav>
			{welcome && (
				<Welcome
					onGuest={() => {
						try {
							sessionStorage.setItem("movesmart-guest", "1");
						} catch {}
						setGuestChosen(true);
					}}
				/>
			)}
			{onboarding && (
				<Onboarding
					initial={profile ?? null}
					onSkip={() => {
						setEditingProfile(false);
						// Skipping still counts as onboarded, with neutral defaults.
						if (!profile) void account.saveProfile(DEFAULT_PROFILE);
					}}
					onDone={(next) => {
						void account.saveProfile(next);
						setEditingProfile(false);
						openPlan();
					}}
				/>
			)}
		</main>
	);
}
