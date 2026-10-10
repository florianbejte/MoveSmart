import { strict as assert } from "node:assert";
import { test } from "node:test";
import { walkingAccess } from "./access";
import { estimateOptions, rankOptions } from "./options";
import { DEFAULT_PROFILE } from "./profile";
import { findRides, type RideSearch } from "./transit";

const point = { lat: 54.7, lon: 25.3 };
test("walking access includes the 13th stop beyond 700 m, excludes detours and unreachable stops", async () => {
	const stops = Array.from({ length: 15 }, (_, i) => ({
		id: String(i),
		lat: 54.7 + i * 0.0006,
		lon: 25.3,
	}));
	const request = (async () =>
		Response.json({
			code: "Ok",
			distances: [[...Array(12).fill(100), 900, 1700, null]],
		})) as typeof fetch;
	const result = await walkingAccess(point, stops, 75, 20, false, request);
	assert.equal(result.distances.get("12"), 900);
	assert.equal(result.distances.has("13"), false);
	assert.equal(result.distances.has("14"), false);
	assert.equal(result.approximate, false);
});
test("egress queries the stop-to-destination direction", async () => {
	const request = (async (url: string | URL | Request) => {
		assert.match(String(url), /sources=1;2&destinations=0/);
		return Response.json({ code: "Ok", distances: [[100], [300]] });
	}) as typeof fetch;
	const result = await walkingAccess(
		point,
		[
			{ id: "a", lat: 54.701, lon: 25.3 },
			{ id: "b", lat: 54.702, lon: 25.3 },
		],
		75,
		20,
		true,
		request,
	);
	assert.equal(result.distances.get("b"), 300);
});
test("routing outages are explicitly marked approximate", async () => {
	const result = await walkingAccess(
		{ lat: 54.71, lon: 25.3 },
		[{ id: "x", lat: 54.712, lon: 25.3 }],
		75,
		20,
		false,
		(async () => {
			throw new Error("offline");
		}) as typeof fetch,
	);
	assert.equal(result.approximate, true);
	assert.ok(result.distances.has("x"));
});
const now = 12 * 3600_000;
const visits = [
	{
		tripId: "early",
		stopId: "far",
		time: 12 * 3600 + 600,
		sequence: 1,
		pickup: true,
	},
	{
		tripId: "early",
		stopId: "end",
		time: 12 * 3600 + 1200,
		sequence: 2,
		pickup: true,
	},
	{
		tripId: "reachable",
		stopId: "far",
		time: 12 * 3600 + 840,
		sequence: 1,
		pickup: true,
	},
	{
		tripId: "reachable",
		stopId: "end",
		time: 12 * 3600 + 1440,
		sequence: 2,
		pickup: true,
	},
];
const query: RideSearch = {
	now,
	origins: new Map([["far", 900]]),
	destinations: new Map([["end", 75]]),
	departures: (s) => visits.filter((v) => v.stopId === s),
	tripVisits: (t) => visits.filter((v) => v.tripId === t),
	serviceStarts: () => [0],
	routeOf: () => "4G",
	delayOf: () => null,
	walkMinutes: (m) => Math.ceil(m / 75),
	boardingMinutes: 1,
};
test("farther direct bus is reachable after the actual walk; earlier departure is rejected", () => {
	const rides = findRides(query);
	assert.equal(rides.length, 1);
	assert.equal(rides[0].tripId, "reachable");
	assert.equal(
		findRides({ ...query, origins: new Map([["far", 1050]]) }).length,
		0,
	);
});
test("ranking retains the fastest, direct and least-walking alternatives", () => {
	const ride = findRides(query)[0];
	const options = estimateOptions({
		from: point,
		to: { lat: 54.73, lon: 25.3 },
		now,
		rides: [{ ...ride, walkToMinutes: 12, walkFromMinutes: 1 }],
		routeName: () => "4G",
		profile: DEFAULT_PROFILE,
	});
	const direct = options.find((o) => o.mode === "transit");
	assert.ok(direct);
	assert.equal(direct.parts.walk, 13); // No second straight-line multiplier.
	const transfers = Array.from({ length: 8 }, (_, i) => ({
		...direct,
		id: `change-${i}`,
		minutes: 20 + i,
		parts: { ...direct.parts, walk: 3 + i },
		legs: [ride, ride],
	}));
	const ranked = rankOptions(
		[...transfers, direct],
		DEFAULT_PROFILE,
		null,
	).filter((o) => o.mode === "transit" && !o.excluded);
	assert.ok(ranked.some((o) => o.id === direct.id));
	assert.ok(ranked.some((o) => o.id === "change-0"));
	assert.ok(ranked.length <= 6);
});
test("no invented bus itinerary when no timetable journey was found", () => {
	const options = estimateOptions({
		from: point,
		to: { lat: 54.73, lon: 25.3 },
		now,
		rides: [],
		routeName: () => "",
		profile: DEFAULT_PROFILE,
	});
	assert.equal(
		options.some((o) => o.mode === "transit"),
		false,
	);
});

test("failed walking lookups are briefly cached as approximate, then retried", async () => {
	const originalNow = Date.now;
	let now = originalNow();
	Date.now = () => now;
	let calls = 0;
	const origin = { lat: 54.7351, lon: 25.3121 };
	const stops = [{ id: "retry-stop", lat: 54.7361, lon: 25.3121 }];
	const request = (async () => {
		calls++;
		if (calls === 1) throw new Error("rate limited");
		return Response.json({ code: "Ok", distances: [[null]] });
	}) as typeof fetch;
	try {
		const first = await walkingAccess(origin, stops, 75, 20, false, request);
		const repeat = await walkingAccess(origin, stops, 75, 20, false, request);
		assert.equal(calls, 1);
		assert.equal(first.approximate, true);
		assert.equal(repeat.approximate, true);
		assert.deepEqual(repeat.distances, first.distances);
		now += 31_000;
		const retried = await walkingAccess(origin, stops, 75, 20, false, request);
		assert.equal(calls, 2);
		assert.equal(retried.approximate, false);
		assert.equal(retried.distances.has("retry-stop"), false);
	} finally {
		Date.now = originalNow;
	}
});
