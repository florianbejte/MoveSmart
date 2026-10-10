import type { Position, Vehicle } from "./types";

/** CSV fields can contain quoted commas, newlines, escaped quotes and a BOM. */
export function parseCsv(text: string): Record<string, string>[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	const input = text.replace(/^\uFEFF/, "");
	for (let i = 0; i < input.length; i++) {
		const c = input[i];
		if (c === '"') {
			if (quoted && input[i + 1] === '"') {
				field += '"';
				i++;
			} else quoted = !quoted;
		} else if (c === "," && !quoted) {
			row.push(field);
			field = "";
		} else if ((c === "\n" || c === "\r") && !quoted) {
			if (c === "\r" && input[i + 1] === "\n") i++;
			row.push(field);
			if (row.some(Boolean)) rows.push(row);
			row = [];
			field = "";
		} else field += c;
	}
	row.push(field);
	if (row.some(Boolean)) rows.push(row);
	const headers = rows.shift() ?? [];
	return rows.map((values) =>
		Object.fromEntries(
			headers.filter(Boolean).map((key, i) => [key, values[i] ?? ""]),
		),
	);
}

const dateFormat = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Europe/Vilnius",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});
export function localParts(at: number) {
	const parts = Object.fromEntries(
		dateFormat.formatToParts(at).map((p) => [p.type, p.value]),
	);
	return {
		date: `${parts.year}${parts.month}${parts.day}`,
		seconds:
			Number(parts.hour) * 3600 +
			Number(parts.minute) * 60 +
			Number(parts.second),
	};
}
/** GTFS service day starts at local noon minus 12 hours, including DST days. */
export function serviceStart(date: string) {
	const noonUtc = Date.UTC(
		Number(date.slice(0, 4)),
		Number(date.slice(4, 6)) - 1,
		Number(date.slice(6, 8)),
		12,
	);
	const offset = localParts(noonUtc).seconds - 12 * 3600;
	return noonUtc - offset * 1000 - 12 * 3600 * 1000;
}
export function shiftDate(date: string, days: number) {
	return new Date(
		Date.UTC(
			Number(date.slice(0, 4)),
			Number(date.slice(4, 6)) - 1,
			Number(date.slice(6, 8)) + days,
		),
	)
		.toISOString()
		.slice(0, 10)
		.replaceAll("-", "");
}
export function gtfsSeconds(value: string) {
	const [h, m, s] = value.split(":").map(Number);
	return h * 3600 + m * 60 + s;
}
export function activeService(
	service: Record<string, string> | undefined,
	exception: string | undefined,
	date: string,
) {
	if (exception) return exception === "1";
	if (!service || date < service.start_date || date > service.end_date)
		return false;
	const day = new Date(
		`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00Z`,
	).getUTCDay();
	return (
		service[
			[
				"sunday",
				"monday",
				"tuesday",
				"wednesday",
				"thursday",
				"friday",
				"saturday",
			][day]
		] === "1"
	);
}
export function distance(a: Position, b: Position) {
	const r = Math.PI / 180;
	const x =
		Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
		Math.cos(a.lat * r) *
			Math.cos(b.lat * r) *
			Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
	return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function freshVehicle(vehicle: Vehicle, at = Date.now()) {
	return at - vehicle.measuredAt < 120_000 && at >= vehicle.measuredAt - 30_000;
}
export function parseVehicles(text: string, sourceTime: number): Vehicle[] {
	const secondsNow = localParts(sourceTime).seconds;
	const midnight = sourceTime - secondsNow * 1000;
	const vehicles = new Map<string, Vehicle>();
	for (const r of parseCsv(text)) {
		if (!["Autobusai", "Troleibusai"].includes(r.Transportas)) continue;
		const lat = Number(r.Platuma) / 1e6;
		const lon = Number(r.Ilguma) / 1e6;
		if (
			!Number.isFinite(lat) ||
			!Number.isFinite(lon) ||
			!r.MasinosNumeris ||
			!r.MatavimoLaikas ||
			!Number.isFinite(Number(r.MatavimoLaikas)) ||
			lat < 53 ||
			lat > 56 ||
			lon < 23 ||
			lon > 27
		)
			continue;
		let measuredAt = midnight + Number(r.MatavimoLaikas) * 1000;
		if (measuredAt > sourceTime + 30_000) measuredAt -= 86400_000;
		const mode = r.Transportas === "Autobusai" ? "bus" : "trolleybus";
		const vehicle: Vehicle = {
			id: `${mode}-${r.MasinosNumeris}`,
			number: r.MasinosNumeris,
			routeId: null,
			route: r.Marsrutas,
			mode,
			destination: r.KryptiesPavadinimas,
			tripId: r.ReisoIdGTFS || null,
			lat,
			lon,
			speed: Number(r.Greitis) || 0,
			heading: Number(r.Azimutas) || 0,
			delay:
				r.NuokrypisSekundemis !== "" &&
				Number.isFinite(Number(r.NuokrypisSekundemis))
					? Number(r.NuokrypisSekundemis)
					: null,
			measuredAt,
		};
		const previous = vehicles.get(vehicle.id);
		if (!previous || previous.measuredAt < measuredAt)
			vehicles.set(vehicle.id, vehicle);
	}
	return [...vehicles.values()];
}
