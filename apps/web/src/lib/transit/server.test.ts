import { strict as assert } from "node:assert";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import {
	getEnrichedLive,
	getLive,
	getSchedule,
	getStopBoard,
	getStopRoutes,
	getTrip,
} from "./server";

test("end-to-end timetable joins, midnight departures, shared cache and outage fallback", async () => {
	const originalFetch = globalThis.fetch;
	const originalNow = Date.now;
	let now = Date.parse("2026-10-10T21:05:00Z"); // Sunday 00:05 in Vilnius
	Date.now = () => now;
	let fail = false;
	let gpsCalls = 0;
	let gtfsCalls = 0;
	const tables = {
		"routes.txt":
			"route_id,route_short_name,route_long_name,route_type,route_color\nr1,2G,Test bus,3,167568\nr2,2,Test trolley,800,AAAAAA",
		"stops.txt":
			"stop_id,stop_name,stop_lat,stop_lon,stop_desc\ns1,Start,54.68,25.27,North\ns2,Next,54.69,25.28,North",
		"trips.txt":
			"route_id,service_id,trip_id,trip_headsign,shape_id\nr1,daily,live,Next,shape\nr1,saturday,night,Next,shape\nr1,daily,no-pickup,Next,shape\nr1,cancelled,cancelled,Next,shape\nr2,daily,scheduled,Next,shape",
		"stop_times.txt":
			"trip_id,stop_id,departure_time,stop_sequence,pickup_type\nlive,s1,00:00:00,1,0\nlive,s2,00:10:00,2,0\nnight,s2,24:10:00,1,0\nno-pickup,s2,00:08:00,1,1\ncancelled,s2,00:09:00,1,0\nscheduled,s2,00:15:00,1,0",
		"calendar.txt":
			"service_id,start_date,end_date,monday,tuesday,wednesday,thursday,friday,saturday,sunday\ndaily,20260101,20261231,1,1,1,1,1,1,1\nsaturday,20260101,20261231,0,0,0,0,0,1,0\ncancelled,20260101,20261231,1,1,1,1,1,1,1",
		"calendar_dates.txt":
			"service_id,date,exception_type\ncancelled,20261011,2",
		"shapes.txt":
			"shape_id,shape_pt_lon,shape_pt_lat,shape_pt_sequence\nshape,25.28,54.69,2\nshape,25.27,54.68,1",
	};
	const archive = zipSync(
		Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, strToU8(v)])),
	);
	globalThis.fetch = (async (url: string | URL | Request) => {
		if (String(url).endsWith("gtfs.zip")) {
			gtfsCalls++;
			if (fail) throw new Error("offline");
			return new Response(archive);
		}
		gpsCalls++;
		if (fail) throw new Error("offline");
		return new Response(
			"Transportas,Marsrutas,MasinosNumeris,Ilguma,Platuma,Greitis,Azimutas,NuokrypisSekundemis,MatavimoLaikas,KryptiesPavadinimas,ReisoIdGTFS\nAutobusai,2G,123,25270000,54680000,20,90,120,299,Next,live",
			{ headers: { "Last-Modified": new Date(now).toUTCString() } },
		);
	}) as typeof fetch;
	try {
		const [network, feed, board] = await Promise.all([
			getSchedule(),
			getEnrichedLive(),
			getStopBoard("s2"),
		]);
		assert.equal(gtfsCalls, 1);
		assert.equal(gpsCalls, 1);
		assert.equal(network.network.routes.length, 2);
		assert.equal(network.network.stops.length, 2);
		assert.equal(feed.vehicles[0].routeId, "r1");
		assert.ok(board);
		assert.deepEqual(
			board.departures.map((d) => d.tripId),
			["night", "live", "scheduled"],
		);
		assert.equal(
			board.departures[1].estimatedAt - board.departures[1].scheduledAt,
			120000,
		);
		assert.equal(board.departures[1].live, true);
		assert.equal(board.departures[0].live, false);
		const outlines = await getStopRoutes("s1");
		assert.ok(outlines);
		assert.equal(outlines.trips.length, 1);
		assert.equal(outlines.trips[0].stops[0].id, "s1");
		assert.deepEqual(outlines.trips[0].coordinates, [
			[25.27, 54.68],
			[25.28, 54.69],
		]);
		assert.equal((await getStopRoutes("s2"))?.trips.length, 0);
		assert.equal(await getStopRoutes("missing"), null);
		const trip = await getTrip("live");
		assert.deepEqual(trip?.coordinates, [
			[25.27, 54.68],
			[25.28, 54.69],
		]);
		assert.deepEqual(
			trip?.stops.map((s) => s.id),
			["s1", "s2"],
		);
		assert.equal(await getStopBoard("missing"), null);
		assert.equal(await getTrip("missing"), null);
		fail = true;
		now += 15_000;
		assert.equal((await getLive()).stale, true);
		assert.equal(
			(await getLive()).stale,
			true,
			"a cached fallback must remain stale",
		);
		const fallback = await getStopBoard("s2");
		assert.equal(fallback?.stale, true);
		assert.ok(
			fallback?.departures.every(
				(d) => !d.live && d.estimatedAt === d.scheduledAt,
			),
		);
		now += 7 * 3600_000;
		assert.equal((await getSchedule()).network.stale, true);
	} finally {
		globalThis.fetch = originalFetch;
		Date.now = originalNow;
	}
});
