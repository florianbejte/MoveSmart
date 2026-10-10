"use client";

import {
	ArrowLeft,
	ArrowUpRight,
	BusFront,
	ChevronRight,
	Clock3,
	LocateFixed,
	MapPin,
	Navigation,
	Radio,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { distance, freshVehicle } from "@/lib/transit/core";
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
import { useTransit } from "./use-transit";
import "./transit.css";

const TransitMap = dynamic(() => import("./transit-map"), {
	ssr: false,
	loading: () => (
		<div className="map-loading">
			<RefreshCw className="spin" size={24} />
			<span>Opening Vilnius…</span>
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
	return (
		<span
			className={`route-badge ${route?.mode === "trolleybus" ? "trolleybus" : "bus"}`}
		>
			{route?.name ?? label ?? "—"}
		</span>
	);
}

export default function TransitExplorer() {
	const network = useTransit<Network>("/api/transit?kind=network", 300_000);
	const live = useTransit<LiveFeed>("/api/transit?kind=vehicles");
	const [query, setQuery] = useState("");
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
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 10_000);
		return () => clearInterval(timer);
	}, []);
	const routes = network.data?.routes ?? [];
	const stops = network.data?.stops ?? EMPTY_STOPS;
	const vehicles = live.data?.vehicles ?? EMPTY_VEHICLES;
	const origin = location ?? center;
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
		setQuery("");
		setSelection({ type: "stop", id });
		setPreviewTrip(null);
		const stop = stops.find((s) => s.id === id);
		if (stop) focusOn(stop);
	}
	function selectVehicle(id: string) {
		setQuery("");
		setSelection({ type: "vehicle", id });
		setPreviewTrip(null);
		const vehicle = vehicles.find((v) => v.id === id);
		if (vehicle) focusOn(vehicle);
	}
	function locate() {
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
		<main className="transit-app">
			<aside className="explorer-panel" aria-label="Transit explorer">
				<div className="explorer-heading">
					<span className="eyebrow">YOUR CITY, IN MOTION</span>
					<h1>Where to next?</h1>
					<p>Find your stop. Catch your ride.</p>
				</div>
				<label className="transit-search">
					<Search size={19} />
					<input
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setSelection(null);
							setPreviewTrip(null);
						}}
						placeholder="Search a stop, route or destination"
						aria-label="Search stops, routes or destinations"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							aria-label="Clear search"
						>
							<X size={16} />
						</button>
					)}
				</label>
				<fieldset className="mode-tabs" aria-label="Transport type">
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
							{label}
						</button>
					))}
				</fieldset>
				<div className="filter-row">
					<label className="route-select">
						<span className="sr-only">Filter by route</span>
						<select
							value={routeId}
							onChange={(e) => setRouteId(e.target.value)}
						>
							<option value="">Every route</option>
							{routes
								.filter((r) => mode === "all" || r.mode === mode)
								.map((r) => (
									<option key={r.id} value={r.id}>
										{r.name} · {r.mode === "trolleybus" ? "Trolleybus" : "Bus"}
									</option>
								))}
						</select>
					</label>
					<button
						type="button"
						className={`nearby-toggle ${nearbyOnly ? "active" : ""}`}
						aria-pressed={nearbyOnly}
						onClick={() => setNearbyOnly((v) => !v)}
					>
						<Navigation size={14} />
						Within 2 km
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
						{locating
							? "Finding your location…"
							: location
								? "Update my location"
								: "Use my location"}
					</span>
					<ArrowUpRight size={17} />
				</button>
				{locationError && (
					<div className="notice" role="status">
						{locationError}
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
						Use map center instead
					</button>
				)}
				{(network.error || live.error || network.data?.stale) && (
					<div className="notice warning" role="status">
						{network.error ||
							live.error ||
							"Using a saved timetable while the source reconnects."}
						<button
							type="button"
							onClick={() => {
								network.retry();
								live.retry();
							}}
						>
							<RefreshCw size={14} />
							Retry
						</button>
					</div>
				)}
				<div className="panel-content" ref={panelContent}>
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
							Back to nearby
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
										STOP · {selectedStop?.id ?? selection.id}
									</span>
									<h2>{selectedStop?.name ?? "Loading stop…"}</h2>
									<p>
										{selectedStop?.description ||
											"Departures from this platform"}
									</p>
								</div>
							</div>
							<div className="stop-route-list">
								{selectedStop?.routeIds.map((id) => (
									<RouteBadge key={id} route={routeById.get(id)} />
								))}
							</div>
							<div className="section-heading">
								<h3>Upcoming departures</h3>
								<span>Vilnius time</span>
							</div>
							<p className="helper-text">
								Live estimates use reported schedule deviation. Scheduled times
								appear when live data is unavailable.
							</p>
							{board.error && (
								<div className="notice warning" role="status">
									Couldn’t refresh departures. Any previous estimates may be
									outdated.
									<button type="button" onClick={board.retry}>
										Try again
									</button>
								</div>
							)}
							{!board.data && !board.error && (
								<p className="loading-text">Loading departures…</p>
							)}
							{board.data?.stale && (
								<p className="notice">
									Some sources are unavailable; times may be scheduled or based
									on a saved timetable.
								</p>
							)}
							{board.data?.departures
								.filter((d) => d.estimatedAt >= now)
								.slice(0, 20)
								.map((d) => {
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
												<strong>{d.destination}</strong>
												<small>
													{isLive
														? "Live estimate"
														: d.live
															? "Last estimate · outdated"
															: "Scheduled"}{" "}
													· {timeFormat.format(d.scheduledAt)}
												</small>
											</span>
											<span
												className={`departure-time ${isLive ? "live" : ""}`}
											>
												<strong>
													{Math.max(
														1,
														Math.ceil((d.estimatedAt - now) / 60_000),
													)}
													<small> min</small>
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
										<h3>No upcoming departures</h3>
										<p>
											No boarding services are scheduled here in the next 24
											hours.
										</p>
									</div>
								)}
							{previewTrip && (
								<p className="helper-text">
									Selected departure’s route is highlighted on the map.
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
										label={selectedVehicle.route}
									/>
									<div>
										<span className="eyebrow">
											{selectedVehicle.mode === "bus" ? "BUS" : "TROLLEYBUS"} ·{" "}
											{selectedVehicle.number}
										</span>
										<h2>
											{selectedVehicle.destination || "Destination unavailable"}
										</h2>
									</div>
								</div>
								<div className="vehicle-metrics">
									<div>
										<span>Speed</span>
										<strong>
											{selectedVehicle.speed}
											<small> km/h</small>
										</strong>
									</div>
									<div>
										<span>Schedule deviation</span>
										<strong>
											{!selectedFresh || selectedVehicle.delay === null
												? "Unknown"
												: Math.abs(selectedVehicle.delay) < 60
													? "On time"
													: `${Math.round(Math.abs(selectedVehicle.delay) / 60)} min ${selectedVehicle.delay > 0 ? "late" : "early"}`}
										</strong>
									</div>
								</div>
								<p
									className={`vehicle-update ${selectedFresh ? "" : "warning"}`}
								>
									<span
										className={`status-dot ${selectedFresh ? "" : "offline"}`}
									/>
									{selectedFresh ? "Live position" : "Last known position"} ·{" "}
									{Math.max(
										0,
										Math.floor((now - selectedVehicle.measuredAt) / 1000),
									)}
									s ago
								</p>
								<button
									className="locate-button secondary"
									type="button"
									onClick={() => focusOn(selectedVehicle)}
								>
									<Navigation size={16} />
									Center on this vehicle
								</button>
								<div className="section-heading">
									<h3>Stops on this trip</h3>
									<span>{trip.data?.stops.length ?? "—"} stops</span>
								</div>
								{!selectedVehicle.tripId && (
									<p className="notice">
										This vehicle has no matching trip information. Its position
										is still shown.
									</p>
								)}
								{selectedVehicle.tripId && !trip.data && !trip.error && (
									<p className="loading-text">Loading route…</p>
								)}
								{trip.data?.stops.map((stop, index) => (
									<button
										type="button"
										className="trip-stop"
										key={`${stop.id}-${index}`}
										onClick={() => selectStop(stop.id)}
									>
										<span className="stop-sequence">{index + 1}</span>
										<span>{stop.name}</span>
										<ChevronRight size={15} />
									</button>
								))}
							</>
						) : (
							<div className="empty-state">
								<BusFront size={25} />
								<h3>Vehicle no longer reporting</h3>
								<p>
									It may have finished its trip. Choose another vehicle from the
									map.
								</p>
							</div>
						)
					) : (
						<>
							<div className="section-heading">
								<h2>{needle ? "Matching stops" : "Nearby stops"}</h2>
								<span>
									{location ? "From your location" : "From map center"}
								</span>
							</div>
							{!network.data && !network.error && (
								<p className="loading-text">
									Loading Vilnius stops and routes…
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
										<strong>{stop.name}</strong>
										<small>
											{metres(metresAway)} away
											{stop.description ? ` · ${stop.description}` : ""}
										</small>
										<span className="stop-route-list">
											{stop.routeIds.slice(0, 6).map((id) => (
												<RouteBadge key={id} route={routeById.get(id)} />
											))}
											{stop.routeIds.length > 6 && (
												<span className="more-routes">
													+{stop.routeIds.length - 6}
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
									<h3>No matching stops</h3>
									<p>Try another name or clear the route filters.</p>
									<button
										type="button"
										className="text-button"
										onClick={resetFilters}
									>
										Clear filters
									</button>
								</div>
							)}
							<div className="section-heading vehicles-heading">
								<h2>Buses around you</h2>
								<span>{filteredVehicles.length} matching</span>
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
										label={vehicle.route}
									/>
									<span className="row-main">
										<strong>
											{vehicle.destination || "Destination unavailable"}
										</strong>
										<small>
											{metres(metresAway)} away ·{" "}
											{freshVehicle(vehicle, now) && !feedStale
												? "Live"
												: "Last known position"}
										</small>
									</span>
									<ChevronRight size={15} />
								</button>
							))}
							{live.data && !nearbyVehicles.length && (
								<p className="notice">
									No vehicles match this area or filter right now.
									<button type="button" onClick={resetFilters}>
										Show all vehicles
									</button>
								</p>
							)}
						</>
					)}
					{trip.error && selection && (
						<div className="notice warning">
							Route details are unavailable.
							<button type="button" onClick={trip.retry}>
								Retry route
							</button>
						</div>
					)}
				</div>
				<footer className="panel-footer">
					<span className={`status-dot ${feedStale ? "offline" : ""}`} />
					<span>
						{!live.data
							? "Connecting to JUDU…"
							: feedStale
								? "Feed interrupted · showing last update"
								: `${freshCount} vehicles reporting live`}
					</span>
					<button
						type="button"
						aria-label="Refresh vehicle positions"
						onClick={live.retry}
					>
						<RefreshCw size={14} />
					</button>
				</footer>
			</aside>
			<section className="map-panel" aria-label="Map and live vehicles">
				<TransitMap
					stale={feedStale}
					now={now}
					vehicles={
						selectedVehicle &&
						!filteredVehicles.some((v) => v.id === selectedVehicle.id)
							? [...filteredVehicles, selectedVehicle]
							: filteredVehicles
					}
					stops={filteredStops}
					trip={trip.data}
					selectedId={selection?.id}
					location={location}
					focus={focus}
					onVehicle={selectVehicle}
					onStop={selectStop}
					onCenter={setCenter}
				/>
				<div className="map-topbar">
					<div className="city-pill">
						<MapPin size={15} />
						<strong>Vilnius</strong>
						<span>Lithuania</span>
					</div>
					<div className={`live-pill ${feedStale ? "is-stale" : ""}`}>
						<span className={`status-dot ${feedStale ? "offline" : ""}`} />
						{!live.data
							? "Connecting"
							: feedStale
								? "Feed delayed"
								: "Live transport"}
					</div>
				</div>
				<div className="map-bottom-card">
					<div>
						<span className="eyebrow">A LITTLE LESS WAITING.</span>
						<strong>A little more city.</strong>
						<p>Select a stop to see what’s coming.</p>
					</div>
					<span className="map-card-icon">
						<BusFront size={30} />
					</span>
				</div>
				<div className="map-legend">
					<span>
						<i className="legend-bus" />
						Bus
					</span>
					<span>
						<i className="legend-trolley" />
						Trolleybus
					</span>
					<span>
						<i className="legend-stop" />
						Stop
					</span>
					<span className="legend-faded">Faded = older position</span>
				</div>
				<a
					className="data-credit"
					href="https://judu.lt/kita-informacija/atviri-duomenys/"
					target="_blank"
					rel="noreferrer"
				>
					Transit data: JUDU / stops.lt ↗
				</a>
			</section>
		</main>
	);
}
