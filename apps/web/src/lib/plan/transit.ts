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
	/** Walking metres to and from the stops. */
	walkToMetres: number;
	walkFromMetres: number;
	walkToMinutes?: number;
	walkFromMinutes?: number;
	departAt: number;
	arriveAt: number;
	stops: number;
	live: boolean;
	delaySeconds: number | null;
};
export type RideSearch = {
	now: number;
	/** Stops near the origin and destination with walking distance in metres. */
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
	boardingMinutes?: number;
};

/** Non-dominated arrival/walking alternatives per route, earliest arrival first. */
export function findRides(q: RideSearch): TransitRide[] {
	const horizon = q.now + (q.horizonMinutes ?? 90) * 60_000;
	const best = new Map<string, TransitRide[]>();
	for (const [fromStopId, walkTo] of q.origins) {
		const ready =
			q.now + (q.walkMinutes(walkTo) + (q.boardingMinutes ?? 0)) * 60_000;
		for (const visit of q.departures(fromStopId)) {
			if (!visit.pickup) continue;
			const routeId = q.routeOf(visit.tripId);
			if (!routeId) continue;
			for (const start of q.serviceStarts(visit.tripId)) {
				const delay = q.delayOf(visit.tripId, start);
				const departAt = start + (visit.time + (delay ?? 0)) * 1000;
				if (departAt < ready || departAt > horizon) continue;
				for (const alight of q.tripVisits(visit.tripId)) {
					if (
						alight.sequence <= visit.sequence ||
						!q.destinations.has(alight.stopId)
					)
						continue;
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
					const walking = (r: TransitRide) => r.walkToMetres + r.walkFromMetres;
					const dominates = (a: TransitRide, b: TransitRide) =>
						doorToDoor(a) <= doorToDoor(b) && walking(a) <= walking(b);
					const current = best.get(routeId) ?? [];
					if (!current.some((r) => dominates(r, ride)))
						best.set(routeId, [
							...current.filter((r) => !dominates(ride, r)),
							ride,
						]);
				}
			}
		}
	}
	return [...best.values()]
		.flat()
		.sort(
			(a, b) =>
				a.arriveAt +
				q.walkMinutes(a.walkFromMetres) * 60_000 -
				(b.arriveAt + q.walkMinutes(b.walkFromMetres) * 60_000),
		);
}

export type TransferTrip = {
	/** First bus, then second bus. leg[0].walkToMetres is the walk from the start,
	 * leg[1].walkToMetres the walk between stops when changing, leg[1].walkFromMetres the walk to the destination. */
	legs: [TransitRide, TransitRide];
};
export type TransferSearch = RideSearch & {
	/** Stops within a short walk of a stop (including itself at 0 m), for changing buses. */
	nearbyStops: (stopId: string) => Map<string, number>;
	minChangeMinutes?: number;
	maxChangeWaitMinutes?: number;
};

/** Trips with exactly one change, fastest door to door first, at most one per pair of routes. */
export function findTransfers(q: TransferSearch): TransferTrip[] {
	const horizon = q.now + (q.horizonMinutes ?? 90) * 60_000;
	const minChange = q.minChangeMinutes ?? 2;
	const maxWait = (q.maxChangeWaitMinutes ?? 25) * 60_000;
	const doorMs = (m: number) => q.walkMinutes(m) * 60_000;
	// 1. Earliest arrival at every stop reachable by one bus from near the start.
	const reached = new Map<string, TransitRide>();
	for (const [fromStopId, walkTo] of q.origins) {
		const ready = q.now + doorMs(walkTo) + (q.boardingMinutes ?? 0) * 60_000;
		for (const visit of q.departures(fromStopId)) {
			if (!visit.pickup) continue;
			const routeId = q.routeOf(visit.tripId);
			if (!routeId) continue;
			for (const start of q.serviceStarts(visit.tripId)) {
				const delay = q.delayOf(visit.tripId, start);
				const departAt = start + (visit.time + (delay ?? 0)) * 1000;
				if (departAt < ready || departAt > horizon) continue;
				for (const later of q.tripVisits(visit.tripId)) {
					if (later.sequence <= visit.sequence) continue;
					const arriveAt = start + (later.time + (delay ?? 0)) * 1000;
					const known = reached.get(later.stopId);
					if (known && known.arriveAt <= arriveAt) continue;
					reached.set(later.stopId, {
						tripId: visit.tripId,
						routeId,
						fromStopId,
						toStopId: later.stopId,
						walkToMetres: walkTo,
						walkFromMetres: 0,
						departAt,
						arriveAt,
						stops: later.sequence - visit.sequence,
						live: delay !== null,
						delaySeconds: delay,
					});
				}
			}
		}
	}
	// 2. Trips that stop near the destination, with where they stop there.
	const finals = new Map<string, Visit[]>();
	for (const stopId of q.destinations.keys())
		for (const visit of q.departures(stopId)) {
			const list = finals.get(visit.tripId) ?? [];
			list.push(visit);
			finals.set(visit.tripId, list);
		}
	const boardings = new Map<string, Visit[]>();
	const boardable = (stopId: string) => {
		let list = boardings.get(stopId);
		if (!list) {
			list = q
				.departures(stopId)
				.filter((v) => v.pickup && finals.has(v.tripId));
			boardings.set(stopId, list);
		}
		return list;
	};
	// 3. Change to a second bus that reaches the destination.
	const best = new Map<string, TransferTrip & { door: number }>();
	for (const [stopId, first] of reached) {
		for (const [changeStopId, walk] of q.nearbyStops(stopId)) {
			const ready = first.arriveAt + Math.max(minChange * 60_000, doorMs(walk));
			for (const visit of boardable(changeStopId)) {
				const routeId = q.routeOf(visit.tripId);
				if (!routeId || routeId === first.routeId) continue;
				const alight = (finals.get(visit.tripId) ?? [])
					.filter((v) => v.sequence > visit.sequence)
					.sort(
						(a, b) =>
							a.time * 1000 +
							doorMs(q.destinations.get(a.stopId) ?? 0) -
							(b.time * 1000 + doorMs(q.destinations.get(b.stopId) ?? 0)),
					)[0];
				if (!alight) continue;
				for (const start of q.serviceStarts(visit.tripId)) {
					const delay = q.delayOf(visit.tripId, start);
					const departAt = start + (visit.time + (delay ?? 0)) * 1000;
					if (departAt < ready || departAt > ready + maxWait) continue;
					const walkFrom = q.destinations.get(alight.stopId) ?? 0;
					const second: TransitRide = {
						tripId: visit.tripId,
						routeId,
						fromStopId: changeStopId,
						toStopId: alight.stopId,
						walkToMetres: walk,
						walkFromMetres: walkFrom,
						departAt,
						arriveAt: start + (alight.time + (delay ?? 0)) * 1000,
						stops: alight.sequence - visit.sequence,
						live: delay !== null,
						delaySeconds: delay,
					};
					const door = second.arriveAt + doorMs(walkFrom);
					const key = `${first.routeId}>${routeId}`;
					const current = best.get(key);
					if (!current || door < current.door)
						best.set(key, { legs: [first, second], door });
				}
			}
		}
	}
	return [...best.values()]
		.sort((a, b) => a.door - b.door)
		.map(({ legs }) => ({ legs }));
}
