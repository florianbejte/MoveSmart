import { strFromU8, unzipSync } from "fflate";
import { walkingAccess } from "../plan/access";
import {
	findRides,
	findTransfers,
	type RideSearch,
	type TransitRide,
} from "../plan/transit";
import {
	activeService,
	distance,
	freshVehicle,
	gtfsSeconds,
	localParts,
	parseCsv,
	parseVehicles,
	serviceStart,
	shiftDate,
} from "./core";
import { serviceColor } from "./service-colors";
import type {
	Departure,
	LiveFeed,
	Network,
	Position,
	Stop,
	StopBoard,
	TransitRoute,
	TripDetail,
} from "./types";

type Row = Record<string, string>;
type StopTime = {
	tripId: string;
	stopId: string;
	time: number;
	sequence: number;
	pickup: boolean;
};
type Schedule = {
	network: Network;
	stops: Map<string, Stop>;
	trips: Map<string, Row>;
	calendar: Map<string, Row>;
	exceptions: Map<string, string>;
	stopTimes: Map<string, StopTime[]>;
	tripStops: Map<string, StopTime[]>;
	shapes: Map<string, [number, number][]>;
};
const GTFS_URL = "https://www.stops.lt/vilnius/vilnius/gtfs.zip";
const GPS_URL = "https://stops.lt/vilnius/gps_full.txt";
const headers = {
	"User-Agent": "MoveSmart/1.0 (+https://github.com/florianbejte/MoveSmart)",
};
let schedule: Schedule | undefined;
let schedulePending: Promise<Schedule> | undefined;
let scheduleAttempt = 0;
let live: LiveFeed | undefined;
let livePending: Promise<LiveFeed> | undefined;
let liveAttempt = 0;

async function fetchSource(url: string) {
	const response = await fetch(url, {
		headers,
		cache: "no-store",
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok)
		throw new Error(`Transit source returned ${response.status}`);
	return response;
}
async function loadSchedule(): Promise<Schedule> {
	const response = await fetchSource(GTFS_URL);
	const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
	const read = (name: string) => {
		if (!archive[name]) throw new Error(`Missing timetable file: ${name}`);
		return parseCsv(strFromU8(archive[name]));
	};
	const routes: TransitRoute[] = read("routes.txt").map((r) => ({
		id: r.route_id,
		name: r.route_short_name,
		title: r.route_long_name,
		mode:
			r.route_id.includes("trolley") || r.route_type === "800"
				? "trolleybus"
				: r.route_type === "3" || r.route_type === "700"
					? "bus"
					: "other",
		color: /^[a-f\d]{6}$/i.test(r.route_color)
			? `#${r.route_color}`
			: serviceColor(
					r.route_short_name,
					r.route_id.includes("trolley") || r.route_type === "800"
						? "trolleybus"
						: "bus",
				),
	}));
	const supported = new Set(
		routes.filter((r) => r.mode !== "other").map((r) => r.id),
	);
	const trips = new Map(
		read("trips.txt")
			.filter((t) => supported.has(t.route_id))
			.map((t) => [t.trip_id, t]),
	);
	const stops = new Map<string, Stop>(
		read("stops.txt").map((s) => [
			s.stop_id,
			{
				id: s.stop_id,
				name: s.stop_name,
				description: s.stop_desc,
				lat: Number(s.stop_lat),
				lon: Number(s.stop_lon),
				routeIds: [],
			},
		]),
	);
	const stopTimes = new Map<string, StopTime[]>();
	const tripStops = new Map<string, StopTime[]>();
	const stopRoutes = new Map<string, Set<string>>();
	for (const r of read("stop_times.txt")) {
		const trip = trips.get(r.trip_id);
		if (!trip) continue;
		const item = {
			tripId: r.trip_id,
			stopId: r.stop_id,
			time: gtfsSeconds(r.departure_time || r.arrival_time),
			sequence: Number(r.stop_sequence),
			pickup: r.pickup_type !== "1",
		};
		if (!Number.isFinite(item.time)) continue;
		if (!stopTimes.has(item.stopId)) stopTimes.set(item.stopId, []);
		if (!tripStops.has(item.tripId)) tripStops.set(item.tripId, []);
		stopTimes.get(item.stopId)?.push(item);
		tripStops.get(item.tripId)?.push(item);
		if (!stopRoutes.has(item.stopId)) stopRoutes.set(item.stopId, new Set());
		stopRoutes.get(item.stopId)?.add(trip.route_id);
	}
	for (const [id, stop] of stops)
		stop.routeIds = [...(stopRoutes.get(id) ?? [])];
	for (const times of tripStops.values())
		times.sort((a, b) => a.sequence - b.sequence);
	const shapeRows = new Map<
		string,
		{ lon: number; lat: number; sequence: number }[]
	>();
	for (const r of read("shapes.txt")) {
		if (!shapeRows.has(r.shape_id)) shapeRows.set(r.shape_id, []);
		shapeRows.get(r.shape_id)?.push({
			lon: Number(r.shape_pt_lon),
			lat: Number(r.shape_pt_lat),
			sequence: Number(r.shape_pt_sequence),
		});
	}
	const shapes = new Map<string, [number, number][]>();
	for (const [id, points] of shapeRows)
		shapes.set(
			id,
			points.sort((a, b) => a.sequence - b.sequence).map((p) => [p.lon, p.lat]),
		);
	const network = {
		stops: [...stops.values()].filter((s) => s.routeIds.length > 0),
		routes: routes
			.filter((r) => supported.has(r.id))
			.sort((a, b) => a.name.localeCompare(b.name, "lt", { numeric: true })),
		updatedAt: Date.now(),
		stale: false,
	};
	if (!network.stops.length || !trips.size)
		throw new Error("Empty timetable received");
	return {
		network,
		stops,
		trips,
		calendar: new Map(read("calendar.txt").map((r) => [r.service_id, r])),
		exceptions: new Map(
			read("calendar_dates.txt").map((r) => [
				`${r.service_id}:${r.date}`,
				r.exception_type,
			]),
		),
		stopTimes,
		tripStops,
		shapes,
	};
}
export async function getSchedule() {
	if (schedule && Date.now() - schedule.network.updatedAt < 6 * 3600_000)
		return schedule;
	if (schedulePending) return schedulePending;
	if (schedule && Date.now() - scheduleAttempt < 60_000) return schedule;
	scheduleAttempt = Date.now();
	schedulePending = loadSchedule()
		.then((data) => {
			schedule = data;
			return data;
		})
		.catch((error) => {
			if (!schedule) throw error;
			schedule.network.stale = true;
			return schedule;
		})
		.finally(() => {
			schedulePending = undefined;
		});
	return schedulePending;
}
export async function getLive(): Promise<LiveFeed> {
	if (live && Date.now() - liveAttempt < 10_000) return live;
	if (livePending) return livePending;
	liveAttempt = Date.now();
	livePending = (async () => {
		const response = await fetchSource(GPS_URL);
		const sourceUpdatedAt =
			Date.parse(response.headers.get("last-modified") ?? "") || Date.now();
		const text = await response.text();
		if (!text.includes("MatavimoLaikas") || !text.includes("ReisoIdGTFS"))
			throw new Error("Invalid vehicle feed");
		live = {
			vehicles: parseVehicles(text, sourceUpdatedAt),
			fetchedAt: Date.now(),
			sourceUpdatedAt,
			stale: Date.now() - sourceUpdatedAt > 120_000,
		};
		return live;
	})()
		.catch((error) => {
			if (!live) throw error;
			live = { ...live, stale: true };
			return live;
		})
		.finally(() => {
			livePending = undefined;
		});
	return livePending;
}
export async function getEnrichedLive() {
	// A timetable outage must not prevent the vehicle map from loading.
	const [feed, data] = await Promise.all([
		getLive(),
		getSchedule().catch(() => null),
	]);
	return {
		...feed,
		vehicles: feed.vehicles.map((v) => ({
			...v,
			routeId:
				(v.tripId && data?.trips.get(v.tripId)?.route_id) ||
				data?.network.routes.find(
					(r) => r.name === v.route && r.mode === v.mode,
				)?.id ||
				null,
		})),
	};
}
export async function getStopBoard(id: string): Promise<StopBoard | null> {
	const [data, feed] = await Promise.all([
		getSchedule(),
		getLive().catch(() => null),
	]);
	const stop = data.stops.get(id);
	if (!stop) return null;
	const now = Date.now();
	const today = localParts(now).date;
	const vehicles = new Map(
		(feed && !feed.stale ? feed.vehicles : [])
			.filter((v) => v.tripId && freshVehicle(v, now))
			.map((v) => [v.tripId, v]),
	);
	const departures: Departure[] = [];
	// Include yesterday for services continuing beyond 24:00, and tomorrow after the last service.
	for (const date of [shiftDate(today, -1), today, shiftDate(today, 1)]) {
		const start = serviceStart(date);
		for (const time of data.stopTimes.get(id) ?? []) {
			if (!time.pickup) continue;
			const trip = data.trips.get(time.tripId);
			if (
				!trip ||
				!activeService(
					data.calendar.get(trip.service_id),
					data.exceptions.get(`${trip.service_id}:${date}`),
					date,
				)
			)
				continue;
			const scheduledAt = start + time.time * 1000;
			const candidate = vehicles.get(time.tripId);
			const times = data.tripStops.get(time.tripId) ?? [];
			// A recurring trip ID only represents the currently running service instance.
			const instanceIsCurrent =
				now >= start + (times[0]?.time ?? 0) * 1000 - 30 * 60_000 &&
				now <= start + (times.at(-1)?.time ?? 0) * 1000 + 2 * 3600_000;
			const vehicle = instanceIsCurrent ? candidate : undefined;
			const isLive = vehicle?.delay !== null && vehicle?.delay !== undefined;
			const estimatedAt =
				scheduledAt + (isLive ? (vehicle.delay ?? 0) : 0) * 1000;
			if (estimatedAt < now || estimatedAt > now + 24 * 3600_000) continue;
			departures.push({
				tripId: time.tripId,
				routeId: trip.route_id,
				destination: trip.trip_headsign || trip.direction_name,
				scheduledAt,
				estimatedAt,
				vehicleId: isLive ? vehicle.id : null,
				live: isLive,
			});
		}
	}
	return {
		stop,
		departures: departures
			.sort((a, b) => a.estimatedAt - b.estimatedAt)
			.slice(0, 40),
		stale: data.network.stale || !feed || feed.stale,
		generatedAt: now,
	};
}
export async function getTrip(id: string): Promise<TripDetail | null> {
	const data = await getSchedule();
	const trip = data.trips.get(id);
	if (!trip) return null;
	return {
		id,
		routeId: trip.route_id,
		destination: trip.trip_headsign || trip.direction_name,
		coordinates: data.shapes.get(trip.shape_id) ?? [],
		stops: (data.tripStops.get(id) ?? []).flatMap((t) => {
			const stop = data.stops.get(t.stopId);
			return stop ? [stop] : [];
		}),
	};
}
/** All published boarding patterns at this exact platform, not a promise of service now. */
export async function getStopRoutes(id: string) {
	const data = await getSchedule();
	if (!data.stops.has(id)) return null;
	const seen = new Set<string>();
	const trips: TripDetail[] = [];
	for (const visit of data.stopTimes.get(id) ?? []) {
		if (!visit.pickup) continue;
		const row = data.trips.get(visit.tripId);
		if (!row) continue;
		const times = data.tripStops.get(visit.tripId) ?? [];
		const index = times.findIndex((t) => t.sequence === visit.sequence);
		if (index < 0 || index === times.length - 1) continue;
		const onward = times.slice(index);
		const key = JSON.stringify([
			row.route_id,
			row.shape_id,
			onward.map((t) => t.stopId),
		]);
		if (seen.has(key)) continue;
		seen.add(key);
		const shape = data.shapes.get(row.shape_id) ?? [];
		// Match preceding stops in sequence so loop routes do not restart at an earlier visit.
		let cursor = 0;
		for (const time of times.slice(0, index + 1)) {
			const stop = data.stops.get(time.stopId);
			if (!stop) continue;
			let nearest = cursor;
			let best = Number.POSITIVE_INFINITY;
			for (let i = cursor; i < shape.length; i++) {
				const d = (shape[i][0] - stop.lon) ** 2 + (shape[i][1] - stop.lat) ** 2;
				if (d < best) {
					best = d;
					nearest = i;
				}
			}
			cursor = nearest;
		}
		trips.push({
			id: visit.tripId,
			routeId: row.route_id,
			destination: row.trip_headsign || row.direction_name,
			coordinates: shape.slice(cursor),
			stops: onward.flatMap((t) => {
				const stop = data.stops.get(t.stopId);
				return stop ? [stop] : [];
			}),
		});
	}
	return { stopId: id, trips, stale: data.network.stale };
}
/** Direct rides between two points in the next 90 minutes, using live delays where vehicles report them. */
const changeIndex = new WeakMap<Schedule, Map<string, Map<string, number>>>();
/** For each stop, the stops within a 250 m walk (itself included), for changing buses. */
function changeStops(data: Schedule) {
	let index = changeIndex.get(data);
	if (index) return index;
	index = new Map();
	const cell = (lat: number, lon: number) =>
		`${Math.floor(lat / 0.003)}:${Math.floor(lon / 0.005)}`;
	const grid = new Map<string, Stop[]>();
	for (const s of data.network.stops) {
		const key = cell(s.lat, s.lon);
		grid.set(key, [...(grid.get(key) ?? []), s]);
	}
	for (const s of data.network.stops) {
		const near = new Map<string, number>([[s.id, 0]]);
		const [la, lo] = [Math.floor(s.lat / 0.003), Math.floor(s.lon / 0.005)];
		for (let i = -1; i <= 1; i++)
			for (let j = -1; j <= 1; j++)
				for (const other of grid.get(`${la + i}:${lo + j}`) ?? []) {
					if (other.id === s.id) continue;
					const d = distance(s, other);
					if (d <= 250) near.set(other.id, d);
				}
		index.set(s.id, near);
	}
	changeIndex.set(data, index);
	return index;
}
export async function getRides(
	from: Position,
	to: Position,
	walkPace = 75,
	maxWalkMinutes = 20,
) {
	const [data, feed] = await Promise.all([
		getSchedule(),
		getLive().catch(() => null),
	]);
	const now = Date.now();
	const [access, egress] = await Promise.all([
		walkingAccess(from, data.network.stops, walkPace, maxWalkMinutes),
		walkingAccess(to, data.network.stops, walkPace, maxWalkMinutes, true),
	]);
	const vehicles = new Map(
		(feed && !feed.stale ? feed.vehicles : [])
			.filter((v) => v.tripId && freshVehicle(v, now))
			.map((v) => [v.tripId, v]),
	);
	const today = localParts(now).date;
	const days = [shiftDate(today, -1), today, shiftDate(today, 1)].map(
		(date) => ({
			date,
			start: serviceStart(date),
		}),
	);
	const query: RideSearch = {
		now,
		origins: access.distances,
		destinations: egress.distances,
		boardingMinutes: 1,
		departures: (stopId) => data.stopTimes.get(stopId) ?? [],
		tripVisits: (tripId) => data.tripStops.get(tripId) ?? [],
		routeOf: (tripId) => data.trips.get(tripId)?.route_id,
		serviceStarts: (tripId) => {
			const trip = data.trips.get(tripId);
			if (!trip) return [];
			return days
				.filter(({ date }) =>
					activeService(
						data.calendar.get(trip.service_id),
						data.exceptions.get(`${trip.service_id}:${date}`),
						date,
					),
				)
				.map((d) => d.start);
		},
		delayOf: (tripId, start) => {
			const times = data.tripStops.get(tripId) ?? [];
			// Live delay applies only to the service instance that is running now.
			const running =
				now >= start + (times[0]?.time ?? 0) * 1000 - 30 * 60_000 &&
				now <= start + (times.at(-1)?.time ?? 0) * 1000 + 2 * 3600_000;
			const delay = running ? vehicles.get(tripId)?.delay : undefined;
			return delay ?? null;
		},
		walkMinutes: (m: number) => Math.ceil(m / walkPace),
	};
	const rides = findRides(query);
	const transfers = findTransfers({
		...query,
		nearbyStops: (stopId) =>
			new Map(
				[...(changeStops(data).get(stopId) ?? new Map([[stopId, 0]]))].map(
					([id, metres]) => [id, metres * 1.3],
				),
			),
	});
	const named = (r: TransitRide) => ({
		...r,
		walkToMinutes: query.walkMinutes(r.walkToMetres),
		walkFromMinutes: query.walkMinutes(r.walkFromMetres),
		fromStop: data.stops.get(r.fromStopId)?.name ?? r.fromStopId,
		toStop: data.stops.get(r.toStopId)?.name ?? r.toStopId,
		destination:
			data.trips.get(r.tripId)?.trip_headsign ||
			data.trips.get(r.tripId)?.direction_name ||
			"",
	});
	return {
		walkingApproximate: access.approximate || egress.approximate,
		rides: rides.map(named),
		transfers: transfers.map((t) => ({ legs: t.legs.map(named) })),
		generatedAt: now,
		stale: data.network.stale || !feed || feed.stale,
	};
}
