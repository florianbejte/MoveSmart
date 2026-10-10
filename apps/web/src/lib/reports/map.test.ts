import { strict as assert } from "node:assert";
import { test } from "node:test";
import { localParts } from "../transit/core";
import type { Departure, Stop, Vehicle } from "../transit/types";
import { reportForDeparture } from "./departures";
import { communityFeatures } from "./map";
import { issueSummaries } from "./store";
import type { CrowdingSummary } from "./types";

const now = 1800000000000;
const report: CrowdingSummary = {
	vehicleId: "v",
	tripId: `${localParts(now).date}:t`,
	level: "full",
	updatedAt: now,
	expiresAt: now + 900000,
	count: 2,
};
const departure: Departure = {
	vehicleId: "v",
	tripId: "t",
	routeId: "r",
	destination: "Centre",
	scheduledAt: now,
	estimatedAt: now,
	live: true,
};
test("departure crowding requires a current live vehicle and exact dated trip", () => {
	assert.equal(reportForDeparture([report], departure, now), report);
	for (const d of [
		{ ...departure, live: false },
		{ ...departure, vehicleId: "other" },
		{ ...departure, tripId: "other" },
	])
		assert.equal(reportForDeparture([report], d, now), undefined);
	assert.equal(
		reportForDeparture([report], departure, report.expiresAt),
		undefined,
	);
});
test("community map groups stop issues and drops expired or changed vehicle trips", () => {
	const stop: Stop = {
		id: "s",
		name: "Stop",
		description: "",
		routeIds: ["r"],
		lat: 54.7,
		lon: 25.2,
	};
	const vehicle: Vehicle = {
		id: "v",
		number: "1",
		routeId: "r",
		route: "1G",
		mode: "bus",
		destination: "Centre",
		tripId: "t",
		lat: 54.7,
		lon: 25.2,
		speed: 0,
		heading: 0,
		delay: null,
		measuredAt: now,
	};
	const issues = issueSummaries(
		[
			{ reporter: "a", stopId: "s", kind: "access", createdAt: now },
			{ reporter: "b", stopId: "s", kind: "shelter", createdAt: now },
		],
		now,
	);
	const feed = { reports: [report], issues };
	const features = communityFeatures(feed, [stop], [vehicle], now).features;
	assert.equal(features.length, 2);
	assert.equal(
		features.find((f) => f.properties.target === "stop")?.properties.count,
		2,
	);
	assert.equal(
		communityFeatures(feed, [stop], [{ ...vehicle, tripId: "next" }], now)
			.features.length,
		1,
	);
	assert.equal(
		communityFeatures(feed, [stop], [vehicle], now + 86400000).features.length,
		0,
	);
});
