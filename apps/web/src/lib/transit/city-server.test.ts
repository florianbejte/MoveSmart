import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getCityLayer } from "./city-server";

test("ArcGIS batches all IDs, shares fetches, accepts empty layers and preserves stale fallback", async () => {
	const originalFetch = globalThis.fetch;
	const originalNow = Date.now;
	let now = Date.UTC(2026, 9, 10, 12);
	let fail = false;
	let batches = 0;
	let idCalls = 0;
	Date.now = () => now;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (fail) throw new Error("offline");
		const load = url.pathname.includes("/24/");
		if (url.searchParams.get("returnIdsOnly")) {
			idCalls++;
			return Response.json({
				objectIds: load ? Array.from({ length: 1049 }, (_, i) => i + 1) : null,
			});
		}
		batches++;
		assert.equal(url.searchParams.get("outSR"), "4326");
		assert.notEqual(url.searchParams.get("outFields"), "*");
		const ids = url.searchParams.get("objectIds")?.split(",") ?? [];
		assert.ok(ids.length <= 300);
		return Response.json({
			type: "FeatureCollection",
			features: ids.map((id) => ({
				type: "Feature",
				geometry: {
					type: "LineString",
					coordinates: [
						[25, 54],
						[25.1, 54.1],
					],
				},
				properties: {
					objectid: Number(id),
					apkrovimas: 24,
					pavadinimas: "Street",
				},
			})),
		});
	}) as typeof fetch;
	try {
		const [first, shared] = await Promise.all([
			getCityLayer("congestion"),
			getCityLayer("congestion"),
		]);
		assert.equal(first.collection.features.length, 1049);
		assert.equal(shared.stale, false);
		assert.equal(idCalls, 4);
		assert.equal(batches, 4);
		fail = true;
		now += 61000;
		const saved = await getCityLayer("congestion");
		assert.equal(saved.stale, true);
		assert.equal(saved.unavailable, 4);
		assert.equal(saved.collection.features.length, 1049);
		assert.equal(saved.fetchedAt, first.fetchedAt);
		assert.equal((await getCityLayer("congestion")).stale, true);
		await assert.rejects(getCityLayer("parking"), /City layer unavailable/);
	} finally {
		globalThis.fetch = originalFetch;
		Date.now = originalNow;
	}
});
