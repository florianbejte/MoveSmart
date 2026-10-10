import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	activeService,
	distance,
	freshVehicle,
	gtfsSeconds,
	localParts,
	parseCsv,
	parseVehicles,
	serviceStart,
	shiftDate,
} from "./core";

test("CSV keeps quoted Lithuanian names, embedded commas and escaped quotes", () => {
	assert.deepEqual(
		parseCsv(
			'\uFEFFid,name,\r\n1,"Žaliasis, tiltas",\r\n2,"A ""quoted""\nname",',
		),
		[
			{ id: "1", name: "Žaliasis, tiltas" },
			{ id: "2", name: 'A "quoted"\nname' },
		],
	);
});
test("Vilnius service days respect midnight, winter offset and GTFS times over 24h", () => {
	assert.equal(localParts(Date.parse("2026-10-10T21:10:00Z")).date, "20261011");
	assert.equal(
		new Date(serviceStart("20261010")).toISOString(),
		"2026-10-09T21:00:00.000Z",
	);
	assert.equal(
		new Date(serviceStart("20260110")).toISOString(),
		"2026-01-09T22:00:00.000Z",
	);
	assert.equal(
		new Date(
			serviceStart("20261010") + gtfsSeconds("25:15:00") * 1000,
		).toISOString(),
		"2026-10-10T22:15:00.000Z",
	);
	assert.equal(shiftDate("20260101", -1), "20251231");
	assert.equal(shiftDate("20261231", 1), "20270101");
});
test("calendar exceptions override weekly schedules", () => {
	const service = {
		start_date: "20260101",
		end_date: "20261231",
		saturday: "1",
		sunday: "0",
	};
	assert.equal(activeService(service, undefined, "20261010"), true);
	assert.equal(activeService(service, "2", "20261010"), false);
	assert.equal(activeService(service, "1", "20261011"), true);
	assert.equal(activeService(undefined, "1", "20261011"), true);
	assert.equal(activeService(service, undefined, "20270102"), false);
});
const header =
	"Transportas,Marsrutas,MasinosNumeris,Ilguma,Platuma,Greitis,Azimutas,NuokrypisSekundemis,MatavimoLaikas,KryptiesPavadinimas,ReisoIdGTFS\n";
test("GPS converts coordinates, keeps missing delay unknown and handles midnight", () => {
	const now = Date.parse("2026-10-10T21:00:20Z");
	const rows = parseVehicles(
		header +
			"Autobusai,2G,123,25279700,54687200,30,180,,86390,Stotis,T1\nTroleibusai,2,123,25279700,54687200,0,0,-60,15,Saulėtekis,T2\nLaivai,L1,444,25279700,54687200,0,0,0,15,Centras,T3",
		now,
	);
	assert.equal(rows.length, 2);
	assert.equal(rows[0].lat, 54.6872);
	assert.equal(rows[0].lon, 25.2797);
	assert.equal(rows[0].delay, null);
	assert.equal(now - rows[0].measuredAt, 30_000);
	assert.equal(rows[1].delay, -60);
	assert.notEqual(rows[0].id, rows[1].id);
	assert.equal(freshVehicle(rows[0], now), true);
	assert.equal(freshVehicle(rows[0], now + 130_000), false);
});
test("GPS drops invalid locations and keeps newest duplicate vehicle", () => {
	const rows = parseVehicles(
		header +
			"Autobusai,2G,123,25279700,54687200,30,180,0,36000,Stotis,T1\nAutobusai,2G,123,25279800,54687200,30,180,0,36005,Stotis,T1\nAutobusai,2G,124,invalid,54687200,30,180,0,36000,Stotis,T1",
		Date.parse("2026-10-10T07:01:00Z"),
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].lon, 25.2798);
});
test("nearby distances are metres and distinguish locations", () => {
	const origin = { lat: 54.6872, lon: 25.2797 };
	assert.equal(distance(origin, origin), 0);
	const north = distance(origin, { lat: 54.6972, lon: 25.2797 });
	assert.ok(north > 1100 && north < 1120);
});
