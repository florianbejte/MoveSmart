import assert from "node:assert/strict";
import { test } from "node:test";
import { withDemoAccess } from "./demo";
import { rankOptions, type TripOption } from "./options";
import { DEFAULT_PROFILE } from "./profile";

test("stroller demo prefers space and excludes simulated steps without changing live input", () => {
	const base: TripOption = {
		id: "quiet",
		mode: "transit",
		label: "Quiet",
		minutes: 20,
		parts: { walk: 3, wait: 2, ride: 15, park: 0 },
		cost: 1,
		co2: 100,
		departAt: 0,
		arriveAt: 1200000,
		estimated: false,
		notes: [],
		legs: [
			{
				tripId: "a",
				routeId: "4G",
				fromStopId: "a",
				toStopId: "b",
				walkToMetres: 100,
				walkFromMetres: 100,
				departAt: 0,
				arriveAt: 900000,
				stops: 4,
				live: false,
				delaySeconds: null,
			},
		],
	};
	const options = [
		base,
		{
			...base,
			id: "busy",
			legs: base.legs?.map((l) => ({ ...l, routeId: "2" })),
		},
	];
	const demo = withDemoAccess(options, (id) => id);
	assert.equal(options[0].demoAccess, undefined);
	assert.equal(demo[0].demoAccess?.occupancy, 25);
	assert.equal(demo[1].demoAccess?.stepFree, false);
	const crowded = {
		...demo[0],
		id: "crowded",
		demoAccess: { occupancy: 85, stepFree: true, strollerSpace: false },
	};
	const profile = { ...DEFAULT_PROFILE, needs: ["stroller" as const] };
	const results = rankOptions([...demo, crowded], profile, null);
	assert.ok(results.find((o) => o.id === "busy")?.excluded?.includes("steps"));
	assert.ok(
		results.find((o) => o.id === "quiet")!.score <
			results.find((o) => o.id === "crowded")!.score,
	);
	assert.ok(
		results
			.find((o) => o.id === "crowded")!
			.terms.some((t) => t.id === "accessibility" && t.minutes === 25),
	);
	assert.equal(
		rankOptions(options, profile, null).find((o) => o.id === "busy")?.excluded,
		undefined,
	);
});
