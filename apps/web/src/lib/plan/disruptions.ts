import { distance } from "../transit/core";
import type { Position } from "../transit/types";
import type { TripOption } from "./options";

/** Something to avoid: an official closure or incident, or a rider report (e.g. a protest). */
export type DisruptionKind =
	| "protest"
	| "event"
	| "blocked"
	| "emergency"
	| "closure"
	| "roadworks"
	| "transit";
export type Disruption = Position & {
	id: string;
	kind: DisruptionKind;
	title: string;
	detail: string;
	start: number | null;
	end: number | null;
	source: "official" | "riders";
	/** Rider reports: how many riders confirmed it and when it was last reported. */
	reports?: number;
	reportedAt?: number;
	/** Transit incidents: affected route numbers, when published. */
	routes?: string[];
};

export const DISRUPTION_INFO: Record<
	DisruptionKind,
	{
		label: string;
		/** Metres around the point that count as affected. */
		radius: number;
		/** "avoid": tell people to stay away; "expect": warn about delays. */
		advice: "avoid" | "expect";
		/** Extra minutes for a car passing through; buses get half (they may be diverted). */
		carDelay: number;
	}
> = {
	protest: {
		label: "Protest or rally",
		radius: 500,
		advice: "avoid",
		carDelay: 12,
	},
	event: {
		label: "Big event crowds",
		radius: 400,
		advice: "avoid",
		carDelay: 10,
	},
	emergency: {
		label: "Police or emergency",
		radius: 300,
		advice: "avoid",
		carDelay: 10,
	},
	blocked: {
		label: "Road blocked",
		radius: 200,
		advice: "expect",
		carDelay: 8,
	},
	closure: { label: "Road closed", radius: 150, advice: "expect", carDelay: 6 },
	roadworks: { label: "Roadworks", radius: 100, advice: "expect", carDelay: 3 },
	transit: {
		label: "Public transport incident",
		radius: 200,
		advice: "expect",
		carDelay: 0,
	},
};

/** Shortest distance in metres from p to the segment a–b (fine at city scale). */
export function distanceToSegment(p: Position, a: Position, b: Position) {
	const k = Math.cos((p.lat * Math.PI) / 180);
	const ax = (a.lon - p.lon) * k;
	const ay = a.lat - p.lat;
	const bx = (b.lon - p.lon) * k;
	const by = b.lat - p.lat;
	const dx = bx - ax;
	const dy = by - ay;
	const len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
	const x = ax + t * dx;
	const y = ay + t * dy;
	return Math.sqrt(x * x + y * y) * 111_320;
}

export function active(d: Disruption, at: number) {
	return (d.start === null || d.start <= at) && (d.end === null || d.end >= at);
}

export type TripImpact = {
	/** Avoid-level or nearby disruptions at the destination or start, worst first. */
	destination: Disruption[];
	start: Disruption[];
	/** Per option: disruptions on its way and the extra minutes they likely add. */
	options: Map<string, { found: Disruption[]; minutes: number }>;
};

const rank = (d: Disruption) =>
	(DISRUPTION_INFO[d.kind].advice === "avoid" ? 0 : 10) +
	Object.keys(DISRUPTION_INFO).indexOf(d.kind);

/**
 * Which disruptions touch a trip. Car-based options use the corridor between start and
 * destination; public transport uses its stops and, for incidents, its route numbers.
 */
export function tripImpact(
	trip: { from: Position; to: Position },
	options: TripOption[],
	disruptions: Disruption[],
	at: number,
	stopPosition: (stopId: string) => Position | undefined,
	routeName: (routeId: string) => string,
): TripImpact {
	const live = disruptions.filter((d) => active(d, at));
	const near = (p: Position) =>
		live
			.filter((d) => distance(p, d) <= DISRUPTION_INFO[d.kind].radius)
			.sort((a, b) => rank(a) - rank(b));
	const impact: TripImpact = {
		destination: near(trip.to),
		start: near(trip.from),
		options: new Map(),
	};
	for (const o of options) {
		let found: Disruption[] = [];
		if (o.mode === "car" || o.mode === "taxi" || o.mode === "carshare") {
			// The driving route isn't known before choosing; streets close to the direct line are a fair proxy.
			found = live.filter(
				(d) =>
					d.kind !== "transit" &&
					distanceToSegment(d, trip.from, trip.to) <=
						Math.max(250, DISRUPTION_INFO[d.kind].radius),
			);
		} else if (o.mode === "transit" && o.legs?.length) {
			const names = o.legs.map((l) => routeName(l.routeId));
			const stops = o.legs
				.flatMap((l) => [l.fromStopId, l.toStopId])
				.map(stopPosition)
				.filter((p): p is Position => !!p);
			found = live.filter(
				(d) =>
					(d.kind === "transit" &&
						(d.routes?.some((r) => names.includes(r)) ||
							stops.some(
								(s) => distance(s, d) <= DISRUPTION_INFO.transit.radius,
							))) ||
					(DISRUPTION_INFO[d.kind].advice === "avoid" &&
						stops.some(
							(s) => distance(s, d) <= DISRUPTION_INFO[d.kind].radius,
						)),
			);
		}
		const carLike = o.mode !== "transit";
		const minutes = Math.min(
			25,
			found.reduce(
				(sum, d) =>
					sum +
					(d.kind === "transit"
						? 5
						: DISRUPTION_INFO[d.kind].carDelay * (carLike ? 1 : 0.5)),
				0,
			),
		);
		if (found.length) impact.options.set(o.id, { found, minutes });
	}
	return impact;
}
