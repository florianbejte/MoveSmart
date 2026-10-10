/**
 * Data behind two terms of the route formula that other journey planners ignore:
 * D_delay, learned from how late each route actually runs, and Q_crowding, from rider
 * reports or the typical load at this time of day.
 */
import type { Vehicle } from "../transit/types";

const clock = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Vilnius",
	weekday: "short",
	hour: "numeric",
	minute: "numeric",
	hourCycle: "h23",
});
function vilnius(at: number) {
	const p = Object.fromEntries(
		clock.formatToParts(at).map((x) => [x.type, x.value]),
	);
	return {
		weekend: p.weekday === "Sat" || p.weekday === "Sun",
		hour: Number(p.hour) + Number(p.minute) / 60,
	};
}

/** Typical load (0 empty – 1 packed) of Vilnius buses at this time, before any reports. */
export function typicalCrowding(at: number) {
	const { weekend, hour } = vilnius(at);
	if (hour < 6 || hour >= 22) return 0.1;
	if (weekend) return hour >= 11 && hour < 18 ? 0.35 : 0.2;
	if ((hour >= 7 && hour < 9) || (hour >= 16 && hour < 18.5)) return 0.75;
	if ((hour >= 6.5 && hour < 10) || (hour >= 15 && hour < 19.5)) return 0.5;
	return 0.3;
}
export const REPORTED_CROWDING = {
	seats: 0.15,
	standing: 0.6,
	full: 0.95,
} as const;

export type DelayStat = { mean: number; samples: number };
// Exponentially weighted lateness per route and hour of day, learned from the live GPS feed.
const delays = new Map<string, DelayStat>();
const seen = new Map<string, number>();
const delayKey = (route: string, mode: string, hour: number) =>
	`${mode}:${route}:${Math.floor(hour)}`;

/** Learn from a GPS snapshot; each vehicle counts at most once a minute. */
export function recordDelays(vehicles: Vehicle[], at = Date.now()) {
	const { hour } = vilnius(at);
	for (const v of vehicles) {
		if (v.delay === null || Math.abs(v.delay) > 3600) continue;
		const last = seen.get(v.id) ?? 0;
		if (at - last < 60_000) continue;
		seen.set(v.id, at);
		const key = delayKey(v.route, v.mode, hour);
		const stat = delays.get(key) ?? { mean: 0, samples: 0 };
		// Early buses don't make you late; lateness is what costs riders time.
		const late = Math.max(0, v.delay) / 60;
		const weight = Math.max(0.05, 1 / (stat.samples + 1));
		delays.set(key, {
			mean: stat.mean + (late - stat.mean) * weight,
			samples: stat.samples + 1,
		});
	}
	if (seen.size > 5000) seen.clear();
}

/**
 * Expected extra minutes beyond the times shown. A live time already includes today's delay,
 * so only part of the usual lateness remains uncertain.
 */
export function expectedDelay(
	route: string,
	mode: string,
	at: number,
	live: boolean,
) {
	const stat = delays.get(delayKey(route, mode, vilnius(at).hour));
	const learned = stat && stat.samples >= 5;
	const typical = typicalCrowding(at) >= 0.5 ? 1.5 : 0.7;
	const mean = learned ? stat.mean : typical;
	return {
		minutes: Math.round((live ? mean * 0.3 : mean) * 10) / 10,
		samples: stat?.samples ?? 0,
		source: learned ? ("learned" as const) : ("typical" as const),
	};
}

export function resetDelaysForTests() {
	delays.clear();
	seen.clear();
}
