import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	estimateOptions,
	rankOptions,
	rushHour,
	type Weather,
	weatherFactor,
} from "./options";
import { sliceShape } from "./paths";
import { DEFAULT_PROFILE, type Profile, persona } from "./profile";
import { findRides, type Visit } from "./transit";

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
			rides: [],
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
	const fast = plan({ ...DEFAULT_PROFILE, sharedOk: false });
	const saver = plan({
		...DEFAULT_PROFILE,
		sharedOk: false,
		priorities: ["cost"],
	});
	assert.equal(best(fast)?.mode, "taxi");
	assert.equal(best(saver)?.mode, "transit");
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
