import { distance } from "../transit/core";
import type { Position } from "../transit/types";
import type { DemoAccess } from "./demo";
import { type Profile, stepFree, walkPace } from "./profile";
import { type Quote, quote } from "./providers";
import type { TransferTrip, TransitRide } from "./transit";

export type Mode =
	| "walk"
	| "bike"
	| "scooter"
	| "transit"
	| "car"
	| "taxi"
	| "carshare";
export type Weather = {
	temperature: number;
	feelsLike: number;
	precipitation: number;
	windGust: number;
	condition: string;
	/** Official LHMT warning for Vilnius county (via MeteoAlarm), if one is active now. */
	warning?: {
		level: "yellow" | "orange" | "red";
		event: string;
		until: number;
	};
};
export type TripOption = {
	id: string;
	demoAccess?: DemoAccess;
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
	/** Park & Ride: drive to this lot and park first, then take the bus. */
	via?: {
		name: string;
		lat: number;
		lon: number;
		driveMinutes: number;
		driveKm: number;
		spaces: number | null;
	};
	/** Every bus of a public transport trip in order: one for a direct ride, two with a change. */
	legs?: TransitRide[];
	/** Closures, incidents or rider-reported trouble on the way, and the minutes they likely add. */
	disruption?: { minutes: number; titles: string[] };
	/** Taxi and car-sharing providers, best first for this rider. */
	quotes?: Quote[];
	notes: string[];
};
/** One term of C_u(r), in perceived minutes, with how it was computed. */
export type Term = {
	id:
		| "ride"
		| "walk"
		| "wait"
		| "transfers"
		| "crowding"
		| "delay"
		| "cost"
		| "co2"
		| "city"
		| "accessibility";
	symbol: string;
	label: string;
	minutes: number;
	detail: string;
};
export type RankedOption = TripOption & {
	/** C_u(r) broken into its terms; score is their sum. */
	terms: Term[];
	/** C_u(r) itself: the six time terms, i.e. how long the trip feels for this rider. */
	feels: number;
	score: number;
	reasons: string[];
	excluded?: string;
	/** Public transport, walking or cycling. */
	green: boolean;
	/** Grams of CO₂ avoided compared with driving the same trip. */
	co2Saved: number;
	/**
	 * Put ahead of a faster car-based option for the city's sake: "best" when the
	 * extra time is reasonable, "greener" when it's a real trade-off we still lead with.
	 */
	promoted?: "best" | "greener";
};

export const GREEN_MODES: Mode[] = ["transit", "walk", "bike"];
/** The terms of the rider's formula; price, CO₂ and city impact are counted separately. */
export const FEEL_TERMS: Term["id"][] = [
	"ride",
	"walk",
	"wait",
	"transfers",
	"crowding",
	"delay",
];
const CAR_MODES: Mode[] = ["car", "taxi", "carshare"];

// Vilnius approximations; see notes shown with each option.
const CENTRE = { lat: 54.6872, lon: 25.2797 };
const WALK_DETOUR = 1.25;
const ROAD_DETOUR = 1.35;
// JUDU single tickets (judu.lt, from 1 July 2025); transfers are free within the time.
const TICKET_30 = 1;
const TICKET_60 = 1.25;
/** A ticket is validated on boarding, so its length depends on time on the buses only. */
export const ticket = (boardAt: number, offAt: number) =>
	offAt - boardAt > 30 * 60_000 ? TICKET_60 : TICKET_30;
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
	// An official warning means conditions are worse than the hourly forecast suggests.
	if (w.warning) {
		extra += { yellow: 0.1, orange: 0.3, red: 0.6 }[w.warning.level];
		reasons.push(
			`${w.warning.level} warning: ${w.warning.event.toLowerCase()}`,
		);
	}
	return { factor: 1 + extra * (sensitive ? 2 : 1), reasons };
}

export function estimateOptions(input: {
	/** "Arrive by": the rider leaves just in time, so no waiting at the first stop. */
	leaveJustInTime?: boolean;
	from: Position;
	to: Position;
	now: number;
	rides: TransitRide[];
	transfers?: TransferTrip[];
	/** Park & Ride candidates: lot, driving distance and the best bus from it. */
	parkRide?: {
		lot: { name: string; lat: number; lon: number; spaces: number | null };
		driveKm: number;
		ride: TransitRide;
	}[];
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
		const walk =
			(ride.walkToMinutes ?? walkMin(ride.walkToMetres)) +
			(ride.walkFromMinutes ?? walkMin(ride.walkFromMetres));
		const wait = input.leaveJustInTime
			? 0
			: Math.max(
					0,
					minutes(ride.departAt - now) -
						(ride.walkToMinutes ?? walkMin(ride.walkToMetres)),
				);
		const rideMin = minutes(ride.arriveAt - ride.departAt);
		options.push({
			...option({
				id: `transit-${ride.tripId}-${ride.fromStopId}-${ride.toStopId}-${Math.floor(ride.departAt / 86400000)}`,
				mode: "transit",
				label: `Route ${input.routeName(ride.routeId)}`,
				parts: { walk, wait, ride: rideMin, park: 0 },
				cost: profile.hasPass ? 0 : ticket(ride.departAt, ride.arriveAt),
				co2: Math.round((rideMin / 60) * 18 * BUS_CO2_KM),
				estimated: false,
				ride,
				legs: [ride],
				notes: ride.live
					? [
							Math.abs(ride.delaySeconds ?? 0) < 60
								? "Live: on time"
								: `Live: ${Math.round(Math.abs(ride.delaySeconds ?? 0) / 60)} min ${(ride.delaySeconds ?? 0) > 0 ? "late" : "early"}`,
						]
					: ["Timetable time"],
			}),
			departAt:
				ride.departAt -
				((ride.walkToMinutes ?? walkMin(ride.walkToMetres)) + 1) * 60_000,
			// Door-to-door arrival: off the bus, then the walk.
			arriveAt:
				ride.arriveAt +
				(ride.walkFromMinutes ?? walkMin(ride.walkFromMetres)) * 60_000,
		});
	}
	for (const { legs } of input.transfers ?? []) {
		const [first, second] = legs;
		const walk =
			(first.walkToMinutes ?? walkMin(first.walkToMetres)) +
			(second.walkToMetres > 0
				? (second.walkToMinutes ?? walkMin(second.walkToMetres))
				: 0) +
			(second.walkFromMinutes ?? walkMin(second.walkFromMetres));
		const startWait = input.leaveJustInTime
			? 0
			: Math.max(
					0,
					minutes(first.departAt - now) -
						(first.walkToMinutes ?? walkMin(first.walkToMetres)),
				);
		const changeWait = Math.max(
			0,
			minutes(second.departAt - first.arriveAt) -
				(second.walkToMetres > 0
					? (second.walkToMinutes ?? walkMin(second.walkToMetres))
					: 0),
		);
		const rideMin =
			minutes(first.arriveAt - first.departAt) +
			minutes(second.arriveAt - second.departAt);
		const live = legs.find((l) => l.live);
		options.push({
			...option({
				id: `transit-${first.tripId}-${second.tripId}-${first.fromStopId}-${second.toStopId}-${Math.floor(first.departAt / 86400000)}`,
				mode: "transit",
				label: `Route ${input.routeName(first.routeId)} + ${input.routeName(second.routeId)}`,
				parts: { walk, wait: startWait + changeWait, ride: rideMin, park: 0 },
				cost: profile.hasPass ? 0 : ticket(first.departAt, second.arriveAt),
				co2: Math.round((rideMin / 60) * 18 * BUS_CO2_KM),
				estimated: false,
				ride: first,
				legs,
				notes: [
					live ? "One change · live times" : "One change · timetable times",
				],
			}),
			departAt:
				first.departAt -
				((first.walkToMinutes ?? walkMin(first.walkToMetres)) + 1) * 60_000,
			arriveAt:
				second.arriveAt +
				(second.walkFromMinutes ?? walkMin(second.walkFromMetres)) * 60_000,
		});
	}
	for (const { lot, driveKm, ride } of input.parkRide ?? []) {
		const driveMinutes = Math.max(
			3,
			Math.round((driveKm / (rushHour(now) ? 17 : 25)) * 60),
		);
		const walkTo = ride.walkToMinutes ?? walkMin(ride.walkToMetres);
		const walkFrom = ride.walkFromMinutes ?? walkMin(ride.walkFromMetres);
		const leave = ride.departAt - (walkTo + 3 + driveMinutes + 1) * 60_000;
		const wait = input.leaveJustInTime ? 0 : Math.max(0, minutes(leave - now));
		const rideMin = minutes(ride.arriveAt - ride.departAt);
		options.push({
			...option({
				id: `parkride-${lot.name}-${ride.tripId}`,
				mode: "transit",
				label: `Park & Ride + Route ${input.routeName(ride.routeId)}`,
				parts: {
					walk: walkTo + walkFrom,
					wait,
					ride: driveMinutes + rideMin,
					park: 3,
				},
				cost: round(
					driveKm * CAR_EUR_KM +
						(profile.hasPass ? 0 : ticket(ride.departAt, ride.arriveAt)),
				),
				co2: Math.round(
					driveKm * CAR_CO2_KM + (rideMin / 60) * 18 * BUS_CO2_KM,
				),
				estimated: false,
				ride,
				legs: [ride],
				via: { ...lot, driveMinutes, driveKm: round(driveKm) },
				notes: [`Drive ${driveMinutes} min to P+R ${lot.name}, park for free`],
			}),
			departAt: leave,
			arriveAt: ride.arriveAt + walkFrom * 60_000,
		});
	}
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
		(() => {
			const quotes = quote(
				"taxi",
				{ km: road, minutes: driveMin, rush },
				profile.priorities,
			);
			const best = quotes.find((q) => q.price !== null);
			return {
				...option({
					id: "taxi",
					mode: "taxi",
					label: best ? `Taxi · ${best.name}` : "Taxi",
					parts: { walk: 0, wait: best?.reach ?? 5, ride: driveMin, park: 0 },
					cost: best?.priceHigh ?? best?.price ?? round(1 + 0.8 * road),
					co2: Math.round(road * CAR_CO2_KM),
					estimated: true,
					notes: [`${quotes.length} apps compared`],
				}),
				quotes,
			};
		})(),
		(() => {
			// Car sharing: walk to the car, drive, park anywhere in the city zone.
			const quotes = quote(
				"carshare",
				{ km: road, minutes: driveMin + 2, rush },
				profile.priorities,
			);
			const best = quotes.find((q) => q.price !== null);
			return {
				...option({
					id: "carshare",
					mode: "carshare",
					label: best ? `Car sharing · ${best.name}` : "Car sharing",
					parts: {
						walk: best?.reach ?? 6,
						wait: 0,
						ride: driveMin,
						park: 2,
					},
					cost: best?.price ?? round(0.15 * (driveMin + 2) + 0.3 * road),
					co2: best?.electric ? 0 : Math.round(road * CAR_CO2_KM),
					estimated: true,
					notes: [`${quotes.length} services compared`],
				}),
				quotes,
			};
		})(),
	);
	return options;
}
const round = (n: number) => Math.round(n * 10) / 10;

/** Generalised cost from the pitch: ride time plus profile-weighted walking, waiting, money, CO₂ and risk. */
/** The rider's weights in C_u(r), from their onboarding answers. */
export type Weights = {
	alpha: number;
	m: number;
	beta: number;
	gamma: number;
	delta: number;
	eta: number;
	perEuro: number;
	perKg: number;
	weather: string[];
};
export function weightsFor(profile: Profile, weather: Weather | null): Weights {
	const p = new Set(profile.priorities);
	const needs = new Set(profile.needs);
	const w = weatherFactor(weather, profile.weatherSensitive);
	return {
		// α: how much a walking minute weighs.
		alpha: round(
			(p.has("comfort") ? 1.4 : 1) *
				(needs.has("luggage") ? 1.5 : 1) *
				(stepFree(profile) || needs.has("older") ? 1.4 : 1),
		),
		// m(W): weather multiplier on time outdoors.
		m: round(w.factor),
		// β: a waiting minute.
		beta: p.has("comfort") || p.has("certainty") ? 1.5 : 1.2,
		// γ: minutes one change feels like.
		gamma:
			(p.has("comfort") ? 8 : 5) * (stepFree(profile) ? 2 : 1) +
			(needs.has("older") || needs.has("kids") ? 3 : 0),
		// δ: minutes a packed vehicle (Q = 1) feels like over the whole ride.
		delta:
			needs.has("stroller") || needs.has("wheelchair")
				? 15
				: p.has("comfort")
					? 12
					: 6,
		// η: weight of each expected minute of delay.
		eta: p.has("certainty") ? 2 : 1,
		// MoveSmart extensions: money and the city's CO₂ in minutes.
		perEuro: p.has("cost") ? 12 : 2,
		perKg: p.has("eco") ? 25 : 12,
		weather: w.reasons,
	};
}

/** C_u(r) = T_ride + α·m(W)·T_walk + β·T_wait + γ·N_transfers + δ·Q_crowding + η·D_delay (+ € and CO₂). */
export function costTerms(o: TripOption, profile: Profile, k: Weights): Term[] {
	const outdoor = o.mode === "bike" || o.mode === "scooter";
	const overLimit = Math.max(0, o.parts.walk - profile.walkLimit);
	const legs = o.legs ?? [];
	const transfers =
		o.mode === "transit" ? (o.estimated ? 1 : Math.max(0, legs.length - 1)) : 0;
	// Q averaged over riding time; D summed over buses. Cars face traffic instead.
	const rideMs = legs.reduce((s, l) => s + (l.arriveAt - l.departAt), 0) || 1;
	const q = o.demoAccess
		? o.demoAccess.occupancy / 100
		: o.mode === "transit"
			? legs.length
				? legs.reduce(
						(s, l) =>
							s + (l.crowding?.value ?? 0.3) * (l.arriveAt - l.departAt),
						0,
					) / rideMs
				: 0.5
			: 0;
	const d =
		o.mode === "transit"
			? legs.length
				? legs.reduce((s, l) => s + (l.expectedDelay?.minutes ?? 1), 0)
				: 3
			: o.mode === "car" || o.mode === "taxi" || o.mode === "carshare"
				? rushHour(o.departAt)
					? 4
					: 1.5
				: 0;
	const qSource = o.demoAccess
		? "demo occupancy"
		: legs.find((l) => l.crowding?.source === "riders")
			? "rider reports"
			: legs.find((l) => l.crowding?.source === "route")
				? "reports on this route"
				: "typical load now";
	const learned = legs.find((l) => l.expectedDelay?.source === "learned");
	const trouble = o.disruption?.minutes ?? 0;
	const terms: Term[] = [
		{
			id: "ride",
			symbol: "T_ride",
			label: outdoor ? "Riding (outdoors)" : "On board",
			minutes: o.parts.ride * (outdoor ? k.m : 1),
			detail:
				outdoor && k.m > 1
					? `${o.parts.ride} min × m(W) ${k.m}`
					: `${o.parts.ride} min`,
		},
		{
			id: "walk",
			symbol: "α·m(W)·T_walk",
			label: "Walking",
			minutes: o.parts.walk * k.alpha * k.m + overLimit * 3,
			detail: `${o.parts.walk} min × α ${k.alpha} × m(W) ${k.m}${overLimit ? " + over your limit" : ""}`,
		},
		{
			id: "wait",
			symbol: "β·T_wait",
			label: o.parts.park ? "Waiting & parking" : "Waiting",
			minutes: (o.parts.wait + o.parts.park) * k.beta,
			detail: `${o.parts.wait + o.parts.park} min × β ${k.beta}`,
		},
		{
			id: "transfers",
			symbol: "γ·N_transfers",
			label: "Changes",
			minutes: transfers * k.gamma,
			detail: `${transfers} × γ ${k.gamma} min`,
		},
		{
			id: "crowding",
			symbol: "δ·Q_crowding",
			label: "Crowding",
			minutes: q * k.delta,
			detail:
				o.mode === "transit"
					? `Q ${q.toFixed(2)} (${qSource}) × δ ${k.delta}`
					: "Your own space",
		},
		{
			id: "delay",
			symbol: "η·D_delay",
			label: o.mode === "transit" ? "Expected delay" : "Traffic risk",
			minutes: (d + trouble) * k.eta,
			detail:
				(o.mode === "transit"
					? `${round(d)} min ${learned ? `(learned from ${learned.expectedDelay?.samples} live readings)` : "(typical)"}`
					: `${d} min`) +
				(trouble
					? ` + ${trouble} min (${o.disruption?.titles.slice(0, 2).join("; ")})`
					: "") +
				` × η ${k.eta}`,
		},
		{
			id: "cost",
			symbol: "€",
			label: "Price",
			minutes: o.cost * k.perEuro,
			detail: `€${o.cost.toFixed(2)} × ${k.perEuro} min/€`,
		},
		{
			id: "co2",
			symbol: "CO₂",
			label: "Emissions",
			minutes: (o.co2 / 1000) * k.perKg,
			detail: `${kg(o.co2)} × ${k.perKg} min/kg`,
		},
	];
	if (CAR_MODES.includes(o.mode))
		terms.push({
			id: "city",
			symbol: "City",
			label: "Congestion & street space",
			minutes: o.co2 === 0 ? 3 : 6,
			detail: "Cars take road and parking space from everyone",
		});
	return terms.map((t) => ({ ...t, minutes: round(t.minutes) }));
}

export function rankOptions(
	options: TripOption[],
	profile: Profile,
	weather: Weather | null,
): RankedOption[] {
	const k = weightsFor(profile, weather);
	const icy = k.weather.includes("slippery");
	const driving =
		options.find((o) => o.mode === "car")?.co2 ??
		options.find((o) => o.mode === "taxi")?.co2 ??
		0;
	const ranked = options.map((o): RankedOption => {
		const terms = costTerms(o, profile, k);
		if (o.demoAccess && stepFree(profile))
			terms.push({
				id: "accessibility",
				symbol: "A",
				label: "Demo boarding comfort",
				minutes: o.demoAccess.strollerSpace ? 0 : 25,
				detail: o.demoAccess.strollerSpace
					? "Demo: stroller space available"
					: "Demo: no stroller space",
			});
		return {
			...o,
			terms,
			score: Math.round(terms.reduce((s, t) => s + t.minutes, 0)),
			feels: Math.round(
				terms
					.filter((t) => FEEL_TERMS.includes(t.id))
					.reduce((s, t) => s + t.minutes, 0),
			),
			reasons: [],
			excluded:
				o.demoAccess && stepFree(profile) && !o.demoAccess.stepFree
					? "Demo: boarding requires steps"
					: exclusion(o, profile, icy),
			// Park & Ride is mostly driving: never "green", never promoted, never logged as saved CO₂.
			green: GREEN_MODES.includes(o.mode) && !o.via,
			co2Saved: Math.max(0, driving - o.co2),
		};
	});
	const usable = ranked
		.filter((o) => !o.excluded)
		.sort((a, b) => a.score - b.score);
	const rest = ranked.filter((o) => o.excluded);
	// Preserve useful transit trade-offs before filling remaining slots by preference score.
	const transit = usable.filter((o) => o.mode === "transit");
	const fastest = [...transit].sort((a, b) => a.minutes - b.minutes)[0];
	const direct = [...transit].sort(
		(a, b) =>
			(a.legs?.length ?? 1) - (b.legs?.length ?? 1) || a.minutes - b.minutes,
	)[0];
	const leastWalk = [...transit].sort(
		(a, b) => a.parts.walk - b.parts.walk || a.minutes - b.minutes,
	)[0];
	const keep = new Set(
		[fastest, direct, leastWalk, transit.find((o) => o.via)].filter(Boolean),
	);
	for (const o of transit) {
		if (keep.size >= 6) break;
		keep.add(o);
	}
	const shown = usable.filter((o) => o.mode !== "transit" || keep.has(o));
	// Green first, always: the best green option leads whenever a car would otherwise win.
	const top = shown[0];
	const green = shown.find((o) => o.green);
	if (top && green && CAR_MODES.includes(top.mode)) {
		const reasonable =
			green.minutes <= Math.max(top.minutes * 2, top.minutes + 15) &&
			green.minutes <= top.minutes + 30;
		green.promoted = reasonable ? "best" : "greener";
		shown.splice(shown.indexOf(green), 1);
		shown.unshift(green);
	}
	for (const o of shown) {
		o.reasons = explain(o, shown, profile, k.weather);
		if (o === fastest)
			o.reasons.splice(o.promoted ? 1 : 0, 0, "Fastest public transport");
		if (o === direct && (o.legs?.length ?? 1) === 1)
			o.reasons.splice(o.promoted ? 1 : 0, 0, "Direct bus · no changes");
		if (o === leastWalk)
			o.reasons.splice(
				o.promoted ? 1 : 0,
				0,
				"Least walking by public transport",
			);
	}
	return [...shown, ...rest];
}

function exclusion(o: TripOption, profile: Profile, icy: boolean) {
	const needs = new Set(profile.needs);
	if ((o.mode === "car" || o.via) && !profile.hasCar)
		return "You don’t have a car";
	if (o.mode === "carshare") {
		if (!profile.sharedOk) return "You prefer not to use shared vehicles";
		if (needs.has("wheelchair")) return "Shared cars aren’t adapted";
	}
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
	if (o.promoted) {
		const car = all.find((x) => CAR_MODES.includes(x.mode));
		const extra = car ? o.minutes - car.minutes : 0;
		reasons.push(
			extra <= 0
				? "Greener choice for Vilnius"
				: o.promoted === "best"
					? `Greener choice — only ${extra} min longer than by car`
					: `Greener way — ${extra} min longer, saves ${kg(o.co2Saved)} CO₂`,
		);
	}
	if (o.green && o.co2Saved >= 50 && o.promoted !== "greener")
		reasons.push(`Saves ${kg(o.co2Saved)} CO₂ vs. driving`);
	const bus = all.find((x) => x.mode === "transit" && x.co2 > 0);
	if (CAR_MODES.includes(o.mode) && bus && o.co2 >= bus.co2 * 2)
		reasons.push(`${Math.round(o.co2 / bus.co2)}× the CO₂ of the bus`);
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
	// Only when the trip really keeps the rider out of it: not a bus trip with a long walk.
	const shelter = weather.find((w) => SHELTER_FROM[w.split(":")[0]]);
	if (
		shelter &&
		["car", "taxi", "carshare", "transit"].includes(o.mode) &&
		o.parts.walk <= 8
	)
		reasons.push(`Sheltered from ${SHELTER_FROM[shelter.split(":")[0]]}`);
	return reasons;
}

/** Weather reasons as nouns, for "Sheltered from …". */
const SHELTER_FROM: Record<string, string> = {
	rain: "the rain",
	"heavy rain": "the heavy rain",
	slippery: "slippery pavements",
	"very cold": "the cold",
	"strong wind": "the wind",
	"yellow warning": "the bad weather",
	"orange warning": "the bad weather",
	"red warning": "the bad weather",
};
export const kg = (grams: number) =>
	grams >= 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${Math.round(grams)} g`;
