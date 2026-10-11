import { strict as assert } from "node:assert";
import { test } from "node:test";
import { companionStep } from "./companion";
import { type Disruption, distanceToSegment, tripImpact } from "./disruptions";
import { toHits } from "./geocode";
import {
	estimateOptions,
	rankOptions,
	rushHour,
	type Weather,
	weatherFactor,
	weightsFor,
} from "./options";
import { sliceShape } from "./paths";
import { DEFAULT_PROFILE, type Profile, persona } from "./profile";
import { quote } from "./providers";
import {
	expectedDelay,
	recordDelays,
	resetDelaysForTests,
	typicalCrowding,
} from "./signals";
import { findRides, findTransfers, type Visit } from "./transit";
import { activeWarning } from "./weather";

const START = Date.parse("2026-10-09T21:00:00Z"); // Vilnius midnight, 10 Oct
const NOW = START + 12 * 3600_000; // 12:00
const visit = (
	tripId: string,
	stopId: string,
	time: number,
	sequence: number,
) => ({
	tripId,
	stopId,
	time,
	sequence,
	pickup: true,
});

test("finds the earliest direct ride per route and applies live delay", () => {
	const visits: Visit[] = [
		visit("t1", "A", 12 * 3600 + 300, 1),
		visit("t1", "B", 12 * 3600 + 900, 2),
		visit("t1", "C", 12 * 3600 + 1200, 3),
		visit("t2", "A", 12 * 3600 + 60, 1), // leaves before we can walk there
		visit("t2", "C", 12 * 3600 + 700, 2),
		visit("t3", "C", 12 * 3600 + 600, 1), // wrong direction
		visit("t3", "A", 12 * 3600 + 900, 2),
	];
	const rides = findRides({
		now: NOW,
		origins: new Map([["A", 150]]),
		destinations: new Map([
			["B", 600],
			["C", 100],
		]),
		departures: (s) => visits.filter((v) => v.stopId === s),
		tripVisits: (t) => visits.filter((v) => v.tripId === t),
		serviceStarts: () => [START],
		routeOf: (t) => ({ t1: "r1", t2: "r2", t3: "r3" })[t],
		delayOf: (t) => (t === "t1" ? 120 : null),
		walkMinutes: (m) => Math.round(m / 75),
	});
	assert.equal(rides.length, 1);
	assert.equal(rides[0].routeId, "r1");
	// Alighting at C (100 m) beats B (600 m) door to door.
	assert.equal(rides[0].toStopId, "C");
	assert.equal(rides[0].departAt, START + (12 * 3600 + 420) * 1000);
	assert.equal(rides[0].live, true);
});

const from = { lat: 54.6872, lon: 25.2797 };
const near = { lat: 54.6905, lon: 25.2797 }; // ~370 m
const far = { lat: 54.7311, lon: 25.2626 }; // ~5 km
const plan = (profile: Profile, to = far, weather: Weather | null = null) =>
	rankOptions(
		estimateOptions({
			from,
			to,
			now: NOW,
			rides: [
				{
					tripId: "fixture",
					routeId: "4G",
					fromStopId: "A",
					toStopId: "B",
					walkToMetres: 400,
					walkFromMetres: 400,
					departAt: NOW + 16 * 60_000,
					arriveAt: NOW + 38 * 60_000,
					stops: 10,
					live: false,
					delaySeconds: null,
				},
			],
			routeName: () => "",
			profile,
		}),
		profile,
		weather,
	);
const best = (list: ReturnType<typeof plan>) => list.find((o) => !o.excluded);

test("short trips favour walking", () => {
	assert.equal(best(plan(DEFAULT_PROFILE, near))?.mode, "walk");
});

test("needs exclude unsuitable modes with a reason", () => {
	const wheelchair = plan({ ...DEFAULT_PROFILE, needs: ["wheelchair"] });
	const excluded = Object.fromEntries(
		wheelchair.filter((o) => o.excluded).map((o) => [o.mode, o.excluded]),
	);
	assert.equal(excluded.bike, "Not step-free");
	assert.equal(excluded.scooter, "Not step-free");
	assert.equal(excluded.car, "You don’t have a car");
	assert.match(excluded.walk ?? "", /over twice your 15-min limit/);
});

test("priorities change the recommendation", () => {
	const saver = plan({
		...DEFAULT_PROFILE,
		sharedOk: false,
		priorities: ["cost"],
	});
	// Cost-focused riders pick the bus on its own merits, without a nudge.
	assert.equal(best(saver)?.mode, "transit");
	assert.equal(best(saver)?.promoted, undefined);
	const green = plan({
		...DEFAULT_PROFILE,
		hasBike: true,
		priorities: ["eco"],
	});
	assert.equal(best(green)?.mode, "bike");
	assert.ok(best(green)?.reasons.includes("Zero emissions"));
});

test("bad weather penalises outdoor modes, twice for sensitive riders", () => {
	const rain = {
		temperature: 8,
		feelsLike: 6,
		precipitation: 3,
		windGust: 5,
		condition: "heavy-rain",
	};
	assert.equal(weatherFactor(rain).factor, 1.4);
	assert.equal(weatherFactor(rain, true).factor, 1.8);
	const ice = { ...rain, temperature: 0, condition: "sleet" };
	const cyclist = plan({ ...DEFAULT_PROFILE, hasBike: true }, far, ice);
	assert.equal(
		cyclist.find((o) => o.mode === "bike")?.excluded,
		"Slippery roads right now",
	);
});

test("rush hour is weekday mornings and evenings in Vilnius", () => {
	assert.equal(rushHour(Date.parse("2026-10-12T05:30:00Z")), true); // Mon 08:30
	assert.equal(rushHour(Date.parse("2026-10-10T05:30:00Z")), false); // Sat
	assert.equal(rushHour(Date.parse("2026-10-12T10:00:00Z")), false); // Mon 13:00
});

test("persona reflects the strongest need or priority", () => {
	assert.equal(
		persona({
			...DEFAULT_PROFILE,
			needs: ["stroller"],
			priorities: ["comfort"],
		}),
		"Comfort-first parent",
	);
	assert.equal(
		persona({ ...DEFAULT_PROFILE, priorities: ["eco"], hasBike: true }),
		"Green cyclist",
	);
});

test("trip shapes are cut between the boarding and alighting stops", () => {
	const shape: [number, number][] = [
		[25.0, 54.0],
		[25.1, 54.0],
		[25.2, 54.0],
		[25.3, 54.0],
		[25.1, 54.0], // loop back past the first stop
	];
	assert.deepEqual(
		sliceShape(shape, { lat: 54.0, lon: 25.1 }, { lat: 54.0, lon: 25.29 }),
		[
			[25.1, 54.0],
			[25.2, 54.0],
			[25.3, 54.0],
		],
	);
});

test("geocoder results drop noise, dedupe and read like addresses", () => {
	const f = (props: Record<string, string>, lon = 25.28, lat = 54.68) => ({
		geometry: { coordinates: [lon, lat] as [number, number] },
		properties: { city: "Vilnius", ...props },
	});
	assert.deepEqual(
		toHits([
			f({
				name: "G9",
				street: "Gedimino pr.",
				housenumber: "9",
				osm_value: "mall",
			}),
			f({ street: "Gedimino pr.", housenumber: "9", osm_value: "atm" }),
			f({
				name: "G9",
				street: "Gedimino pr.",
				housenumber: "9",
				osm_value: "mall",
			}),
			f({
				street: "Kalvarijų g.",
				housenumber: "1",
				osm_value: "house",
				district: "Žirmūnai",
			}),
		]).map((h) => [h.name, h.detail, h.kind]),
		[
			["G9", "Gedimino pr. 9", "mall"],
			["Kalvarijų g. 1", "Žirmūnai", "house"],
		],
	);
	assert.deepEqual(
		toHits(
			[
				f({
					name: "G9",
					street: "Gedimino pr.",
					housenumber: "9",
					osm_value: "mall",
				}),
			],
			"Gedimino pr 9",
		).map((h) => [h.name, h.kind]),
		[
			["Gedimino pr. 9", "address"],
			["G9", "mall"],
		],
	);
});

test("taxi and car-sharing quotes pick the cheapest and most reliable", () => {
	const taxis = quote("taxi", { km: 5, minutes: 12, rush: false }, ["speed"]);
	const byId = Object.fromEntries(taxis.map((q) => [q.id, q]));
	assert.equal(byId.bolt.price, 3.9); // 0.80 + 5 × 0.33 + 12 × 0.12
	assert.ok(byId.bolt.badges.includes("Cheapest"));
	assert.ok(byId.bolt.badges.includes("Most reliable"));
	assert.equal(taxis[0].id, "bolt");
	const rush = quote("taxi", { km: 5, minutes: 12, rush: true }, ["cost"]);
	const bolt = rush.find((q) => q.id === "bolt");
	assert.equal(bolt?.priceHigh, 5.9);
	assert.ok(bolt?.badges.includes("Surge pricing likely now"));
	// Metered taxis don't surge, so at rush hour they can be the cheapest.
	assert.equal(rush.find((q) => q.badges.includes("Cheapest"))?.id, "metered");
	const cars = quote("carshare", { km: 5, minutes: 14, rush: false }, ["eco"]);
	assert.equal(cars.find((q) => q.id === "bolt-drive")?.price, null);
	assert.ok(cars.find((q) => q.id === "spark")?.badges.includes("Electric"));
});

test("a reasonable bus beats a faster car for the city's sake, with the CO₂ shown", () => {
	const driver = { ...DEFAULT_PROFILE, hasCar: true, sharedOk: false };
	const ride = {
		tripId: "t",
		routeId: "r53",
		fromStopId: "a",
		toStopId: "b",
		walkToMetres: 200,
		walkFromMetres: 200,
		departAt: NOW + 6 * 60_000,
		arriveAt: NOW + 26 * 60_000,
		stops: 8,
		live: true,
		delaySeconds: 0,
	};
	const ranked = rankOptions(
		estimateOptions({
			from,
			to: far,
			now: NOW,
			rides: [ride],
			routeName: () => "53",
			profile: driver,
		}),
		driver,
		null,
	);
	const top = best(ranked);
	assert.equal(top?.mode, "transit");
	assert.ok(top?.green);
	assert.ok(top?.reasons.some((r) => r.startsWith("Saves")));
	const car = ranked.find((o) => o.mode === "car");
	assert.ok(car?.reasons.some((r) => r.endsWith("the CO₂ of the bus")));
});

test("a much slower green option still leads, labelled as a trade-off", () => {
	const fast = plan({ ...DEFAULT_PROFILE, sharedOk: false });
	const top = best(fast);
	assert.equal(top?.mode, "transit");
	assert.equal(top?.promoted, "greener");
	assert.match(top?.reasons[0] ?? "", /^Greener way — \d+ min longer, saves/);
	// The car-based option stays visible right after it.
	assert.equal(fast.filter((o) => !o.excluded)[1]?.mode, "taxi");
});

test("no green nudge when no green option suits the rider", () => {
	const rider = {
		...DEFAULT_PROFILE,
		needs: ["wheelchair" as const],
		walkLimit: 5,
	};
	const ranked = rankOptions(
		estimateOptions({
			from,
			to: far,
			now: NOW,
			rides: [],
			routeName: () => "",
			profile: rider,
		}),
		rider,
		null,
	);
	assert.equal(best(ranked)?.mode, "taxi");
	assert.equal(best(ranked)?.promoted, undefined);
});

test("one-change trips name both buses, the change stop and a realistic connection", () => {
	const h = 12 * 3600;
	const visits: Visit[] = [
		// Route 10: A → X → Y
		visit("t10", "A", h + 300, 1),
		visit("t10", "X", h + 900, 2),
		visit("t10", "Y", h + 1500, 3),
		// Route 53 from X' (across the street from X) to D; one leaves too soon to catch.
		visit("t53early", "X2", h + 960, 1),
		visit("t53early", "D", h + 1500, 2),
		visit("t53", "X2", h + 1200, 1),
		visit("t53", "D", h + 1800, 2),
	];
	const trips = findTransfers({
		now: NOW,
		origins: new Map([["A", 100]]),
		destinations: new Map([["D", 150]]),
		departures: (s) => visits.filter((v) => v.stopId === s),
		tripVisits: (t) => visits.filter((v) => v.tripId === t),
		serviceStarts: () => [START],
		routeOf: (t) => ({ t10: "r10", t53early: "r53", t53: "r53" })[t],
		delayOf: () => null,
		walkMinutes: (m) => Math.ceil(m / 75),
		nearbyStops: (s) =>
			s === "X"
				? new Map([
						["X", 0],
						["X2", 60],
					])
				: new Map([[s, 0]]),
	});
	assert.equal(trips.length, 1);
	const [first, second] = trips[0].legs;
	assert.deepEqual(
		[first.routeId, first.fromStopId, first.toStopId],
		["r10", "A", "X"],
	);
	// The 12:16 bus leaves 1 min after arrival — too tight — so we take the 12:20 one.
	assert.deepEqual(
		[second.routeId, second.tripId, second.fromStopId, second.toStopId],
		["r53", "t53", "X2", "D"],
	);
	assert.equal(second.walkToMetres, 60);
});

test("the score is exactly the sum of the C_u(r) terms", () => {
	for (const o of plan(DEFAULT_PROFILE)) {
		const sum = o.terms.reduce((s, t) => s + t.minutes, 0);
		assert.ok(Math.abs(sum - o.score) <= 1, `${o.id}: ${sum} vs ${o.score}`);
		assert.deepEqual(
			o.terms.slice(0, 6).map((t) => t.id),
			["ride", "walk", "wait", "transfers", "crowding", "delay"],
		);
	}
});

test("weights follow the profile: comfort, step-free and certainty", () => {
	const base = weightsFor(DEFAULT_PROFILE, null);
	const parent = weightsFor(
		{
			...DEFAULT_PROFILE,
			needs: ["stroller"],
			priorities: ["comfort", "certainty"],
		},
		null,
	);
	assert.ok(parent.alpha > base.alpha);
	assert.ok(parent.gamma > base.gamma);
	assert.equal(parent.delta, 15);
	assert.equal(parent.eta, 2);
	assert.equal(base.m, 1);
});

test("a crowded bus costs a stroller parent more than an empty one", () => {
	const parent = { ...DEFAULT_PROFILE, needs: ["stroller" as const] };
	const ride = (value: number) => ({
		tripId: "t",
		routeId: "r",
		fromStopId: "a",
		toStopId: "b",
		walkToMetres: 100,
		walkFromMetres: 100,
		departAt: NOW + 5 * 60_000,
		arriveAt: NOW + 20 * 60_000,
		stops: 5,
		live: false,
		delaySeconds: null,
		crowding: { value, source: "riders" as const, reports: 2 },
	});
	const score = (value: number) =>
		rankOptions(
			estimateOptions({
				from,
				to: far,
				now: NOW,
				rides: [ride(value)],
				routeName: () => "53",
				profile: parent,
			}),
			parent,
			null,
		)
			.find((o) => o.mode === "transit")
			?.terms.find((t) => t.id === "crowding");
	assert.equal(score(0.15)?.minutes, 2.3);
	assert.equal(score(0.95)?.minutes, 14.3);
	assert.match(score(0.95)?.detail ?? "", /rider reports/);
});

test("typical crowding peaks at rush hour; delays are learned from live GPS", () => {
	assert.equal(typicalCrowding(Date.parse("2026-10-12T05:30:00Z")), 0.75); // Mon 08:30
	assert.equal(typicalCrowding(Date.parse("2026-10-12T22:00:00Z")), 0.1); // Tue 01:00
	resetDelaysForTests();
	const at = Date.parse("2026-10-12T05:30:00Z");
	const bus = (id: string, delay: number) => ({
		id,
		number: id,
		routeId: null,
		route: "4G",
		mode: "bus" as const,
		destination: "",
		tripId: null,
		speed: 0,
		heading: 0,
		delay,
		measuredAt: at,
		lat: 0,
		lon: 0,
	});
	recordDelays(
		[1, 2, 3, 4, 5, 6].map((i) => bus(`v${i}`, 180)),
		at,
	);
	const learned = expectedDelay("4G", "bus", at, false);
	assert.equal(learned.source, "learned");
	assert.equal(learned.minutes, 3);
	// A live time already includes today's delay; only part stays uncertain.
	assert.equal(expectedDelay("4G", "bus", at, true).minutes, 0.9);
	assert.equal(expectedDelay("7", "trolleybus", at, false).source, "typical");
});

test("disruptions: avoid zones at the destination, closures on the way, incidents on your route", () => {
	const profile = { ...DEFAULT_PROFILE, hasCar: true };
	const ride = {
		tripId: "t",
		routeId: "r53",
		fromStopId: "a",
		toStopId: "b",
		walkToMetres: 100,
		walkFromMetres: 100,
		departAt: NOW + 5 * 60_000,
		arriveAt: NOW + 25 * 60_000,
		stops: 6,
		live: false,
		delaySeconds: null,
	};
	const options = estimateOptions({
		from,
		to: far,
		now: NOW,
		rides: [ride],
		routeName: () => "53",
		profile,
	});
	const mid = { lat: (from.lat + far.lat) / 2, lon: (from.lon + far.lon) / 2 };
	const d = (
		kind: Disruption["kind"],
		at: { lat: number; lon: number },
		extra = {},
	) => ({
		id: kind,
		kind,
		title: kind,
		detail: "",
		start: null,
		end: null,
		source: "official" as const,
		...at,
		...extra,
	});
	const impact = tripImpact(
		{ from, to: far },
		options,
		[
			d(
				"protest",
				{ lat: far.lat + 0.002, lon: far.lon },
				{ source: "riders" },
			),
			d("closure", mid),
			d("transit", { lat: 0, lon: 0 }, { routes: ["53"] }),
			d("roadworks", mid, { end: NOW - 1 }), // already over
		],
		NOW,
		(id) => (id === "a" ? from : id === "b" ? far : undefined),
		() => "53",
	);
	assert.deepEqual(
		impact.destination.map((x) => x.kind),
		["protest"],
	);
	const car = impact.options.get("car");
	// The car also drives into the protest zone at the destination.
	assert.deepEqual(
		car?.found.map((x) => x.kind),
		["protest", "closure"],
	);
	assert.equal(car?.minutes, 18);
	const busId = options.find((o) => o.mode === "transit")?.id ?? "";
	const bus = impact.options.get(busId);
	assert.deepEqual(bus?.found.map((x) => x.kind).sort(), [
		"protest",
		"transit",
	]);
	assert.ok(distanceToSegment(mid, from, far) < 1);
});

test("official weather warnings for Vilnius raise the outdoor weight", () => {
	const now = Date.parse("2026-10-10T08:00:00Z");
	const cap = (
		area: string,
		level: string,
		onset: string,
		expires: string,
	) => ({
		alert: {
			info: [
				{
					language: "lt-LT",
					event: "Vėjas",
					area: [{ areaDesc: area }],
					expires,
				},
				{
					language: "en-GB",
					event: "Strong wind",
					onset,
					expires,
					area: [{ areaDesc: area }],
					parameter: [{ valueName: "awareness_level", value: level }],
				},
			],
		},
	});
	const warning = activeWarning(
		{
			warnings: [
				cap(
					"Vilniaus apskritis",
					"2; yellow; Moderate",
					"2026-10-10T06:00:00Z",
					"2026-10-10T20:00:00Z",
				),
				cap(
					"Vilniaus apskritis",
					"3; orange; Severe",
					"2026-10-10T07:00:00Z",
					"2026-10-10T12:00:00Z",
				),
				cap(
					"Klaipėdos apskritis",
					"4; red; Extreme",
					"2026-10-10T06:00:00Z",
					"2026-10-10T20:00:00Z",
				),
				cap(
					"Vilniaus apskritis",
					"4; red; Extreme",
					"2026-10-10T10:00:00Z",
					"2026-10-10T20:00:00Z",
				),
			],
		},
		now,
	);
	assert.equal(warning?.level, "orange");
	const calm = {
		temperature: 10,
		feelsLike: 10,
		precipitation: 0,
		windGust: 5,
		condition: "cloudy",
	};
	assert.equal(weatherFactor(calm).factor, 1);
	assert.equal(
		weatherFactor({ ...calm, warning: warning ?? undefined }).factor,
		1.3,
	);
});

test("trip companion: when to leave, board, change and get off, following live delays", () => {
	const leg = (
		i: number,
		from: string,
		to: string,
		route: string,
		dep: number,
		arr: number,
	) => ({
		tripId: `t${i}`,
		routeId: route,
		route,
		fromStopId: from,
		toStopId: to,
		fromStop: from,
		toStop: to,
		walkToMetres: 0,
		walkFromMetres: 0,
		departAt: NOW + dep * 60_000,
		arriveAt: NOW + arr * 60_000,
		stops: 4,
		live: false,
		delaySeconds: null,
	});
	const legs = [leg(0, "A", "B", "10", 15, 25), leg(1, "B", "C", "53", 28, 40)];
	const at = (m: number, delay: number | null = null) =>
		companionStep(legs, NOW + m * 60_000, () => delay, 5);
	assert.equal(at(0).key, "wait");
	assert.equal(at(0).title, "Leave in 9 min");
	assert.equal(at(10).key, "walk");
	assert.equal(at(14).key, "board-0");
	assert.equal(at(20).key, "ride-0");
	assert.equal(at(24).key, "exit-0");
	assert.match(at(24).detail, /change to bus 53/);
	assert.equal(at(26.5).key, "change-0");
	assert.equal(at(39).key, "exit-1");
	assert.equal(at(42).key, "done");
	// The first bus now reports 4 min late: still time to wait at home.
	assert.equal(at(10, 240).key, "wait");
	// Planned far ahead: a clock time, not hundreds of minutes.
	assert.match(
		companionStep(legs, NOW - 5 * 3600_000, () => null, 5).title,
		/^Leave at \d\d:\d\d$/,
	);
	// Park & Ride: drive first, then walk to the stop.
	const pr = (m: number) =>
		companionStep(legs, NOW + m * 60_000, () => null, 12, {
			lot: "Sėlių g. 62",
			minutes: 8,
		});
	assert.equal(pr(3).key, "drive");
	assert.equal(pr(11).key, "walk");
});
