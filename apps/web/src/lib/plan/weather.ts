import type { Weather } from "./options";

const FORECAST_URL =
	"https://api.meteo.lt/v1/places/vilnius/forecasts/long-term";
let cached: { value: Weather | null; at: number } | undefined;

/** The current hour from the LHMT (meteo.lt) Vilnius forecast, cached for 10 minutes. */
export async function getWeather(): Promise<Weather | null> {
	if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
	try {
		const response = await fetch(FORECAST_URL, {
			headers: { "User-Agent": "MoveSmart/1.0" },
			cache: "no-store",
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`Weather returned ${response.status}`);
		const value = currentHour(await response.json(), Date.now());
		if (value) value.warning = (await getWarning()) ?? undefined;
		cached = { value, at: Date.now() };
		return value;
	} catch {
		// Planning still works without weather; keep a stale value if there is one.
		return cached?.value ?? null;
	}
}

export function currentHour(json: unknown, now: number): Weather | null {
	const hours = (
		(json as { forecastTimestamps?: Record<string, unknown>[] })
			.forecastTimestamps ?? []
	)
		.map((t) => ({
			at: Date.parse(`${String(t.forecastTimeUtc).replace(" ", "T")}Z`),
			temperature: Number(t.airTemperature),
			feelsLike: Number(t.feelsLikeTemperature),
			precipitation: Number(t.totalPrecipitation) || 0,
			windGust: Number(t.windGust) || 0,
			condition: String(t.conditionCode ?? ""),
		}))
		.filter((h) => Number.isFinite(h.at) && Number.isFinite(h.temperature))
		.sort((a, b) => a.at - b.at);
	const hour = hours.findLast((h) => h.at <= now) ?? hours[0];
	if (!hour) return null;
	const { at: _at, ...weather } = hour;
	return weather;
}

const WARNINGS_URL =
	"https://feeds.meteoalarm.org/api/v1/warnings/feeds-lithuania";
type CapInfo = {
	language: string;
	event: string;
	onset?: string;
	effective?: string;
	expires: string;
	area: { areaDesc: string }[];
	parameter?: { valueName: string; value: string }[];
};
/** The most severe active LHMT warning (yellow or worse) for Vilnius county, or null. */
export function activeWarning(
	json: unknown,
	now: number,
): Weather["warning"] | null {
	const alerts =
		(json as { warnings?: { alert: { info: CapInfo[] } }[] }).warnings ?? [];
	const rank = { yellow: 1, orange: 2, red: 3 } as const;
	let worst: NonNullable<Weather["warning"]> | null = null;
	for (const { alert } of alerts) {
		const en =
			alert.info.find((i) => i.language.startsWith("en")) ?? alert.info[0];
		if (
			!en ||
			!alert.info.some((i) => i.area.some((a) => /vilni/i.test(a.areaDesc)))
		)
			continue;
		const level = en.parameter
			?.find((p) => p.valueName === "awareness_level")
			?.value.split(";")[1]
			?.trim()
			.toLowerCase();
		if (level !== "yellow" && level !== "orange" && level !== "red") continue;
		const onset = Date.parse(en.onset ?? en.effective ?? "") || 0;
		const until = Date.parse(en.expires);
		if (onset > now || !(until > now)) continue;
		if (!worst || rank[level] > rank[worst.level])
			worst = { level, event: en.event, until };
	}
	return worst;
}
async function getWarning() {
	try {
		const response = await fetch(WARNINGS_URL, {
			headers: { "User-Agent": "MoveSmart/1.0" },
			cache: "no-store",
			signal: AbortSignal.timeout(8_000),
		});
		if (!response.ok) return null;
		return activeWarning(await response.json(), Date.now());
	} catch {
		return null;
	}
}
