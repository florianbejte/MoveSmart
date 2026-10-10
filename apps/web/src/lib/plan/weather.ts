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
