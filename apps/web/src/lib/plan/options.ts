import { distance } from "../transit/core";
import type { Position } from "../transit/types";
import { type Profile, stepFree, walkPace } from "./profile";
import type { TransitRide } from "./transit";

export type Mode = "walk" | "bike" | "scooter" | "transit" | "car" | "taxi";
export type Weather = {
	temperature: number;
	feelsLike: number;
	precipitation: number;
	windGust: number;
	condition: string;
};
export type TripOption = {
	id: string;
	mode: Mode;
	label: string;
	minutes: number;
	parts: { walk: number; wait: number; ride: number; park: number };
	/** Euros for this trip; 0 when already paid for (own bike, transit pass). */
	cost: number;
	co2: number;
	departAt: number;
	arriveAt: number;
	estimated: boolean;
	ride?: TransitRide;
	notes: string[];
};
export type RankedOption = TripOption & {
	score: number;
	reasons: string[];
	excluded?: string;
};

// Vilnius approximations; see notes shown with each option.
const CENTRE = { lat: 54.6872, lon: 25.2797 };
const WALK_DETOUR = 1.25;
const ROAD_DETOUR = 1.35;
const TICKET_30 = 1;
const TICKET_60 = 1.5;
const CAR_EUR_KM = 0.13;
const CAR_CO2_KM = 165;
const BUS_CO2_KM = 50;
const PARKING_EUR_HOUR = 2.5;

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const clock = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Vilnius",
	weekday: "short",
	hour: "numeric",
	hourCycle: "h23",
});
/** Weekday 7–10 and 16–19 in Vilnius. */
export function rushHour(at: number) {
	const parts = Object.fromEntries(
		clock.formatToParts(at).map((p) => [p.type, p.value]),
	);
	const h = Number(parts.hour);
	return (
		!["Sat", "Sun"].includes(parts.weekday) &&
		((h >= 7 && h < 10) || (h >= 16 && h < 19))
	);
}

/** f(W): how much longer time outdoors feels. Weather-sensitive riders feel it twice as much. */
export function weatherFactor(w: Weather | null, sensitive = false) {
	if (!w) return { factor: 1, reasons: [] as string[] };
	const reasons: string[] = [];
	let extra = 0;
	if (
		/snow|sleet|freezing|hail/.test(w.condition) ||
		(w.temperature <= 1 && w.precipitation > 0)
	) {
		extra += 0.5;
		reasons.push("slippery");
	} else if (w.precipitation >= 2 || /heavy|thunder/.test(w.condition)) {
		extra += 0.4;
		reasons.push("heavy rain");
	} else if (w.precipitation > 0.2 || /rain/.test(w.condition)) {
		extra += 0.2;
		reasons.push("rain");
	}
	if (w.feelsLike <= -10) {
		extra += 0.2;
		reasons.push("very cold");
	}
	if (w.windGust >= 15) {
		extra += 0.15;
		reasons.push("strong wind");
	}
	return { factor: 1 + extra * (sensitive ? 2 : 1), reasons };
}

export function estimateOptions(input: {
	from: Position;
	to: Position;
	now: number;
	rides: TransitRide[];
	routeName: (routeId: string) => string;
	profile: Profile;
}): TripOption[] {
	const { from, to, now, profile } = input;
	const straight = distance(from, to);
	const road = (straight * ROAD_DETOUR) / 1000;
	const pace = walkPace(profile);
	const walkMin = (m: number) =>
		Math.max(1, Math.round((m * WALK_DETOUR) / pace));
	const option = (
		o: Omit<TripOption, "departAt" | "arriveAt" | "minutes"> & {
			departAt?: number;
		},
	): TripOption => {
		const total = o.parts.walk + o.parts.wait + o.parts.ride + o.parts.park;
		const departAt = o.departAt ?? now;
		return {
			...o,
			minutes: total,
			departAt,
			arriveAt: now + total * 60_000,
		};
	};
	const options: TripOption[] = [
		option({
			id: "walk",
			mode: "walk",
			label: "Walk",
			parts: { walk: walkMin(straight), wait: 0, ride: 0, park: 0 },
			cost: 0,
			co2: 0,
			estimated: false,
			notes: [],
		}),
	];
	const bikeRide = Math.max(2, Math.round((straight * 1.2) / 250));
	options.push(
		option({
			id: "bike",
			mode: "bike",
			label: profile.hasBike ? "Your bike" : "Shared bike",
			parts: {
				walk: profile.hasBike ? 1 : 3,
				wait: 0,
				ride: bikeRide,
				park: 1,
			},
			cost: profile.hasBike ? 0 : round(0.5 + 0.15 * bikeRide),
			co2: 0,
			estimated: false,
			notes: profile.hasBike ? [] : ["Shared bike price is approximate"],
		}),
	);
	const scooterRide = Math.max(2, Math.round((straight * 1.2) / 300));
	options.push(
		option({
			id: "scooter",
			mode: "scooter",
			label: "E-scooter",
			parts: { walk: 3, wait: 0, ride: scooterRide, park: 1 },
			cost: round(0.5 + 0.2 * scooterRide),
			co2: Math.round(straight * 0.035),
			estimated: false,
			notes: ["Scooter price is approximate"],
		}),
	);
	for (const ride of input.rides) {
		const walk = walkMin(ride.walkToMetres) + walkMin(ride.walkFromMetres);
		const wait = Math.max(
			0,
			minutes(ride.departAt - now) - walkMin(ride.walkToMetres),
		);
		const rideMin = minutes(ride.arriveAt - ride.departAt);
		const total = walk + wait + rideMin;
		options.push({
			...option({
				id: `transit-${ride.tripId}`,
				mode: "transit",
				label: `Route ${input.routeName(ride.routeId)}`,
				parts: { walk, wait, ride: rideMin, park: 0 },
				cost: profile.hasPass ? 0 : total > 30 ? TICKET_60 : TICKET_30,
				co2: Math.round((rideMin / 60) * 18 * BUS_CO2_KM),
				estimated: false,
				ride,
				notes: ride.live
					? [
							Math.abs(ride.delaySeconds ?? 0) < 60
								? "Live: on time"
								: `Live: ${Math.round(Math.abs(ride.delaySeconds ?? 0) / 60)} min ${(ride.delaySeconds ?? 0) > 0 ? "late" : "early"}`,
						]
					: ["Timetable time"],
			}),
			departAt: ride.departAt - walkMin(ride.walkToMetres) * 60_000,
		});
	}
	if (!input.rides.length && straight > 800)
		options.push(
			option({
				id: "transit-estimate",
				mode: "transit",
				label: "Bus with a change",
				parts: {
					walk: walkMin(400) * 2,
					wait: 9,
					ride: Math.round((road / 17) * 60),
					park: 0,
				},
				cost: profile.hasPass ? 0 : TICKET_60,
				co2: Math.round(road * BUS_CO2_KM),
				estimated: true,
				notes: ["No direct ride in the next 90 min — estimate with one change"],
			}),
		);
	const rush = rushHour(now);
	const driveMin = Math.max(3, Math.round((road / (rush ? 17 : 27)) * 60));
	const central = distance(to, CENTRE) < 1500;
	options.push(
		option({
			id: "car",
			mode: "car",
			label: "Drive",
			parts: {
				walk: central ? 4 : 2,
				wait: 0,
				ride: driveMin,
				park: central ? 8 : 3,
			},
			cost: round(road * CAR_EUR_KM + (central ? PARKING_EUR_HOUR : 0)),
			co2: Math.round(road * CAR_CO2_KM),
			estimated: true,
			notes: [
				rush ? "Rush hour traffic" : "Typical traffic",
				...(central ? ["Paid parking zone; time to find a spot"] : []),
			],
		}),
		option({
			id: "taxi",
			mode: "taxi",
			label: "Taxi / ride-hailing",
			parts: { walk: 0, wait: 5, ride: driveMin, park: 0 },
			cost: round(Math.max(3.5, 1.5 + 0.65 * road)),
			co2: Math.round(road * CAR_CO2_KM),
			estimated: true,
			notes: ["Fare is approximate"],
		}),
	);
	return options;
}
const round = (n: number) => Math.round(n * 10) / 10;

/** Generalised cost from the pitch: ride time plus profile-weighted walking, waiting, money, CO₂ and risk. */
export function rankOptions(
	options: TripOption[],
	profile: Profile,
	weather: Weather | null,
): RankedOption[] {
	const p = new Set(profile.priorities);
	const w = weatherFactor(weather, profile.weatherSensitive);
	const icy = w.reasons.includes("slippery");
	const comfort = p.has("comfort") ? 1.4 : 1;
	const walkWeight =
		comfort *
		(profile.needs.includes("luggage") ? 1.5 : 1) *
		(stepFree(profile) ? 1.4 : 1);
	const perEuro = p.has("cost") ? 7 : 2;
	const perKg = p.has("eco") ? 25 : 3;
	const ranked = options.map((o): RankedOption => {
		const excluded = exclusion(o, profile, icy);
		const outdoor =
			o.mode === "bike" || o.mode === "scooter" ? o.parts.ride : 0;
		const overLimit = Math.max(0, o.parts.walk - profile.walkLimit);
		let score =
			o.parts.ride +
			outdoor * (w.factor - 1) +
			o.parts.walk * walkWeight * w.factor +
			overLimit * 3 +
			o.parts.wait * (p.has("comfort") ? 1.5 : 1.2) +
			o.parts.park * 1.5 +
			o.cost * perEuro +
			(o.co2 / 1000) * perKg;
		if (o.estimated) score += p.has("certainty") ? 8 : 3;
		if (o.ride?.live && p.has("certainty")) score -= 2;
		if (o.mode === "transit" && o.label.includes("change"))
			score += (p.has("comfort") ? 6 : 3) * (stepFree(profile) ? 2 : 1);
		if ((o.mode === "bike" || o.mode === "scooter") && p.has("comfort"))
			score += 4;
		if ((o.mode === "walk" || o.mode === "bike") && p.has("eco")) score -= 3;
		return { ...o, score: Math.round(score), reasons: [], excluded };
	});
	const usable = ranked
		.filter((o) => !o.excluded)
		.sort((a, b) => a.score - b.score);
	const rest = ranked.filter((o) => o.excluded);
	// Keep only the best public transport ride plus one alternative so modes stay comparable.
	let rides = 0;
	const shown = usable.filter((o) => o.mode !== "transit" || rides++ < 2);
	for (const o of shown) o.reasons = explain(o, shown, profile, w.reasons);
	return [...shown, ...rest];
}

function exclusion(o: TripOption, profile: Profile, icy: boolean) {
	const needs = new Set(profile.needs);
	if (o.mode === "car" && !profile.hasCar) return "You don’t have a car";
	if (o.mode === "bike" || o.mode === "scooter") {
		if (needs.has("wheelchair")) return "Not step-free";
		if (needs.has("stroller") || needs.has("luggage"))
			return needs.has("stroller") ? "Not with a stroller" : "Not with luggage";
		if (o.mode === "scooter" && (needs.has("kids") || needs.has("older")))
			return "Not suitable for this trip";
		if (o.mode === "scooter" && !profile.sharedOk)
			return "You prefer not to use shared vehicles";
		if (o.mode === "bike" && !profile.hasBike && !profile.sharedOk)
			return "No bike available";
		if (icy) return "Slippery roads right now";
	}
	if (o.parts.walk > Math.max(profile.walkLimit * 2, 8))
		return `${o.parts.walk} min walking — over twice your ${profile.walkLimit}-min limit`;
	return undefined;
}

function explain(
	o: RankedOption,
	all: RankedOption[],
	profile: Profile,
	weather: string[],
) {
	const reasons: string[] = [];
	const others = all.filter((x) => x.id !== o.id);
	if (others.every((x) => o.minutes <= x.minutes))
		reasons.push("Fastest door to door");
	if (others.every((x) => o.cost <= x.cost))
		reasons.push(o.cost === 0 ? "Free" : "Cheapest");
	if (o.co2 === 0) reasons.push("Zero emissions");
	else if (others.every((x) => o.co2 <= x.co2)) reasons.push("Lowest CO₂");
	if (
		o.parts.walk > 0 &&
		o.parts.walk <= profile.walkLimit &&
		o.mode !== "walk"
	)
		reasons.push(`${o.parts.walk} min walking — within your limit`);
	if (o.parts.walk > profile.walkLimit)
		reasons.push(
			`${o.parts.walk} min walking — over your ${profile.walkLimit}-min limit`,
		);
	if (o.mode === "transit" && stepFree(profile))
		reasons.push("Vilnius buses and trolleybuses are low-floor");
	if (
		weather.length &&
		(o.mode === "walk" || o.mode === "bike" || o.mode === "scooter")
	)
		reasons.push(`Outdoors in ${weather.join(", ")}`);
	if (
		weather.length &&
		(o.mode === "car" || o.mode === "taxi" || o.mode === "transit")
	)
		reasons.push(`Sheltered from the ${weather[0]}`);
	return reasons;
}
