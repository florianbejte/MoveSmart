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

test("shelters preserve published capacity and distinguish unknown access from no", () => {
	const shelter = normaliseCityFeature(
		feature({
			pavadinimas: "<b>School</b>",
			gyventoju_skaicius: 150,
			patekimas_visa_para: 0,
			pritaikyta_asmenims_su_negalia: null,
			gatve: "Vilniaus g.",
			namo_numeris: "10",
			atnaujinimo_data: Date.UTC(2026, 9, 1),
		}),
		"shelters",
		source,
		now,
	);
	assert.ok(shelter);
	assert.equal(shelter.properties.title, "School");
	assert.match(
		shelter.properties.description,
		/Published capacity: 150 people/,
	);
	assert.match(shelter.properties.description, /24-hour entry: No/);
	assert.match(shelter.properties.description, /disabilities: Not reported/);
	assert.match(shelter.properties.description, /2026-10-01/);
	assert.equal(shelter.properties.end, null);
	assert.match(shelter.properties.timing, /occupancy unknown/);
});

test("cycling paths keep unique segment IDs without guessing undocumented codes", () => {
	const feature = {
		type: "Feature" as const,
		id: 1,
		geometry: {
			type: "LineString" as const,
			coordinates: [
				[25.2, 54.7],
				[25.21, 54.71],
			],
		},
		properties: {
			OBJECTID_1: 1,
			OBJECTID: 415,
			b_1: "<b>Įrengta 2018 m.</b>",
			Shape_Length: 92.56,
			TIPAS_1: 2,
			DANGA_1: "A",
		},
	};
	const a = normaliseCityFeature(feature, "bikes", "ktvis", Date.now());
	const b = normaliseCityFeature(
		{ ...feature, properties: { ...feature.properties, OBJECTID_1: 2 } },
		"bikes",
		"ktvis",
		Date.now(),
	);
	assert.ok(a && b);
	assert.notEqual(a.properties.id, b.properties.id);
	assert.match(a.properties.description, /93 m/);
	assert.match(a.properties.description, /Įrengta 2018 m\./);
	assert.doesNotMatch(a.properties.description, /<b>|Asphalt|protected/i);
	assert.equal(a.properties.end, null);
	assert.equal(
		normaliseCityFeature(
			{ ...feature, geometry: { type: "Point", coordinates: [25, 54] } },
			"bikes",
			"ktvis",
			Date.now(),
		),
		null,
	);
});
