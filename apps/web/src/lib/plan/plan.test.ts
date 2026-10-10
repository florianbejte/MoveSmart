import { strict as assert } from "node:assert";
import { test } from "node:test";
import { toHits } from "./geocode";
import {
	estimateOptions,
	rankOptions,
	rushHour,
	type Weather,
	weatherFactor,
} from "./options";
import { sliceShape } from "./paths";
import { DEFAULT_PROFILE, type Profile, persona } from "./profile";
import { quote } from "./providers";
import { findRides, findTransfers, type Visit } from "./transit";

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
