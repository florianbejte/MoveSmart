/** One-seat public transport rides between two places, found from the GTFS timetable. */
export type Visit = {
	tripId: string;
	stopId: string;
	/** Seconds after the service day start. */
	time: number;
	sequence: number;
	pickup: boolean;
};
export type TransitRide = {
	tripId: string;
	routeId: string;
	fromStopId: string;
	toStopId: string;
	/** Straight-line metres to and from the stops. */
	walkToMetres: number;
	walkFromMetres: number;
	departAt: number;
	arriveAt: number;
	stops: number;
	live: boolean;
	delaySeconds: number | null;
};
export type RideSearch = {
	now: number;
	/** Stops near the origin and destination with straight-line distance in metres. */
	origins: Map<string, number>;
	destinations: Map<string, number>;
	departures: (stopId: string) => Visit[];
	tripVisits: (tripId: string) => Visit[];
	/** Start times of service days on which the trip runs. */
	serviceStarts: (tripId: string) => number[];
	routeOf: (tripId: string) => string | undefined;
	/** Live delay of the running trip instance, if a vehicle reports it. */
	delayOf: (tripId: string, start: number) => number | null;
	walkMinutes: (metres: number) => number;
	horizonMinutes?: number;
};

/** Best ride per route, earliest arrival first. */
export function findRides(q: RideSearch): TransitRide[] {
	const horizon = q.now + (q.horizonMinutes ?? 90) * 60_000;
	const best = new Map<string, TransitRide>();
	for (const [fromStopId, walkTo] of q.origins) {
		const ready = q.now + q.walkMinutes(walkTo) * 60_000;
		for (const visit of q.departures(fromStopId)) {
			if (!visit.pickup) continue;
			const routeId = q.routeOf(visit.tripId);
			if (!routeId) continue;
			for (const start of q.serviceStarts(visit.tripId)) {
				const delay = q.delayOf(visit.tripId, start);
				const departAt = start + (visit.time + (delay ?? 0)) * 1000;
				if (departAt < ready || departAt > horizon) continue;
				let alight: Visit | undefined;
				for (const later of q.tripVisits(visit.tripId)) {
					if (later.sequence <= visit.sequence) continue;
					const walkFrom = q.destinations.get(later.stopId);
					if (walkFrom === undefined) continue;
					const better =
						!alight ||
						later.time * 1000 + q.walkMinutes(walkFrom) * 60_000 <
							alight.time * 1000 +
								q.walkMinutes(q.destinations.get(alight.stopId) ?? 0) * 60_000;
					if (better) alight = later;
				}
				if (!alight) continue;
				const walkFromMetres = q.destinations.get(alight.stopId) ?? 0;
				const ride: TransitRide = {
					tripId: visit.tripId,
					routeId,
					fromStopId,
					toStopId: alight.stopId,
					walkToMetres: walkTo,
					walkFromMetres,
					departAt,
					arriveAt: start + (alight.time + (delay ?? 0)) * 1000,
					stops: alight.sequence - visit.sequence,
					live: delay !== null,
					delaySeconds: delay,
				};
				const doorToDoor = (r: TransitRide) =>
					r.arriveAt + q.walkMinutes(r.walkFromMetres) * 60_000;
				const current = best.get(routeId);
				if (!current || doorToDoor(ride) < doorToDoor(current))
					best.set(routeId, ride);
			}
		}
	}
	return [...best.values()]
		.sort(
			(a, b) =>
				a.arriveAt +
				q.walkMinutes(a.walkFromMetres) * 60_000 -
				(b.arriveAt + q.walkMinutes(b.walkFromMetres) * 60_000),
		)
		.slice(0, 4);
}
