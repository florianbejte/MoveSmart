import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Feature } from "geojson";
import {
	eventStillRelevant,
	matchesRoutes,
	normaliseCityFeature,
} from "./city";

const now = Date.UTC(2026, 9, 10, 12);
const source = "https://example.com/MapServer/22";
const feature = (properties: Record<string, unknown>): Feature => ({
	type: "Feature",
	geometry: { type: "Point", coordinates: [25.28, 54.69] },
	properties: {
		objectid: 1,
		visible: 1,
		eventperformfromdate: now - 60000,
		eventperformtodate: now + 60000,
		...properties,
	},
});
test("expired, hidden and unpublished events never become active alerts", () => {
	for (const properties of [
		{ eventperformtodate: now - 1 },
		{ visible: 0 },
		{ eventshowfromdate: now + 1 },
		{ eventshowtodate: now - 1 },
	])
		assert.equal(
			normaliseCityFeature(feature(properties), "incidents", source, now),
			null,
		);
});
test("normalisation keeps public text, exact route numbers and source dates only", () => {
	const result = normaliseCityFeature(
		feature({
			eventdescription: "<b>Road closed</b>",
			pt_routes: "2G, 12; 2G",
			pt_routes_affected: "3",
			createdby: "private name",
			eventdescription_internal: "private note",
		}),
		"incidents",
		source,
		now,
	);
	assert.equal(result?.properties.description, "Road closed");
	assert.ok(!JSON.stringify(result)?.includes("private"));
	assert.deepEqual(result?.properties.routes, ["2G", "12", "3"]);
	if (!result) throw new Error("Missing event");
	assert.equal(matchesRoutes(result, ["2"]), false);
	assert.equal(matchesRoutes(result, ["2G"]), true);
	assert.equal(eventStillRelevant(result.properties, now + 60001), false);
});
test("planned, recurring and undated events have distinct labels", () => {
	assert.equal(
		normaliseCityFeature(
			feature({ eventperformfromdate: now + 1 }),
			"roadworks",
			source,
			now,
		)?.properties.timing,
		"Planned",
	);
	assert.ok(
		normaliseCityFeature(
			feature({ repeatable: 1 }),
			"roadworks",
			source,
			now,
		)?.properties.timing?.includes("Recurring"),
	);
	assert.equal(
		normaliseCityFeature(
			feature({
				visible: null,
				eventperformfromdate: null,
				eventperformtodate: null,
			}),
			"roadworks",
			source,
			now,
		)?.properties.timing,
		"Timing unconfirmed",
	);
});
test("alternate congestion schema is normalised and ended records filtered", () => {
	const f: Feature = {
		type: "Feature",
		geometry: {
			type: "LineString",
			coordinates: [
				[25, 54],
				[25.1, 54.1],
			],
		},
		properties: {
			objectid: 1,
			event_description: "Congestion",
			event_perform_from_date: now - 1000,
			event_perform_to_date: now - 1,
		},
	};
	assert.equal(normaliseCityFeature(f, "congestion", source, now), null);
});
test("road load is not presented as timestamped live traffic or percent", () => {
	const result = normaliseCityFeature(
		feature({ apkrovimas: 24 }),
		"congestion",
		source,
		now,
	);
	assert.equal(result?.properties.timing, "Measurement time unavailable");
	assert.ok(result?.properties.description?.includes("24"));
	assert.ok(!result?.properties.description?.includes("%"));
});
test("parking uses published zone colors", () => {
	const result = normaliseCityFeature(
		feature({ zona: "Melyna" }),
		"parking",
		source,
		now,
	);
	assert.equal(result?.properties.title, "Blue zone");
	assert.equal(result?.properties.color, "#3479be");
});
