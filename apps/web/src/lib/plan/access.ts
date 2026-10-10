import { distance } from "../transit/core";
import type { Position } from "../transit/types";

type StopPoint = Position & { id: string };
type Access = { distances: Map<string, number>; approximate: boolean };
const cache = new Map<string, { metres: number | null; expires: number }>();

// Share a single request queue between access and egress to avoid bursting the public service.
let queue: Promise<void> = Promise.resolve();
let lastRequest = 0;
const matrixRequest: typeof fetch = async (url) => {
	const result = queue.then(async () => {
		const delay = Math.max(0, 1100 - (Date.now() - lastRequest));
		if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
		lastRequest = Date.now();
		return fetch(url, {
			headers: { "User-Agent": "MoveSmart/1.0" },
			signal: AbortSignal.timeout(8000),
		});
	});
	queue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
};

/** All stops within the walking budget; the straight-line check is only a lower bound.
 * OSRM's foot matrix respects the street network, including crossings and bridges.
 * Destination queries run stop → destination, not the reverse. */
export async function walkingAccess(
	point: Position,
	stops: StopPoint[],
	pace: number,
	limit: number,
	reverse = false,
	request: typeof fetch = matrixRequest,
): Promise<Access> {
	const candidates = stops.filter((s) => distance(point, s) <= pace * limit);
	const distances = new Map<string, number>();
	let approximate = false;
	const key = (s: StopPoint) =>
		`${point.lat},${point.lon}:${s.lat},${s.lon}:${reverse}`;
	const missing: StopPoint[] = [];
	for (const s of candidates) {
		const hit = cache.get(key(s));
		if (hit && hit.expires > Date.now()) {
			if (hit.metres !== null && hit.metres <= pace * limit)
				distances.set(s.id, hit.metres);
		} else missing.push(s);
	}
	// Small matrices avoid a request per stop and the service's coordinate limit.
	for (let offset = 0; offset < missing.length; offset += 40) {
		const batch = missing.slice(offset, offset + 40);
		const points = [point, ...batch].map((p) => `${p.lon},${p.lat}`).join(";");
		const indices = batch.map((_, i) => i + 1).join(";");
		try {
			const response = await request(
				`https://routing.openstreetmap.de/routed-foot/table/v1/driving/${points}?sources=${reverse ? indices : "0"}&destinations=${reverse ? "0" : indices}&annotations=distance`,
				{
					headers: { "User-Agent": "MoveSmart/1.0" },
					signal: AbortSignal.timeout(5000),
				},
			);
			const data = (await response.json()) as {
				code: string;
				distances?: (number | null)[][];
				sources?: { distance: number }[];
				destinations?: { distance: number }[];
			};
			if (!response.ok || data.code !== "Ok" || !data.distances)
				throw new Error("No walking matrix");
			const values = batch.map((_, i) => {
				const d = reverse ? data.distances?.[i]?.[0] : data.distances?.[0]?.[i];
				if (d === null) return null; // Explicitly unreachable, never approximate this.
				if (typeof d !== "number" || !Number.isFinite(d) || d < 0)
					throw new Error("Invalid walking distance");
				return (
					d +
					(data.sources?.[reverse ? i : 0]?.distance ?? 0) +
					(data.destinations?.[reverse ? 0 : i]?.distance ?? 0)
				);
			});
			batch.forEach((s, i) => {
				const metres = values[i];
				cache.set(key(s), { metres, expires: Date.now() + 3600_000 });
				if (metres !== null && metres <= pace * limit)
					distances.set(s.id, metres);
			});
		} catch {
			approximate = true;
			for (const s of batch) {
				const metres = distance(point, s) * 1.3;
				if (metres <= pace * limit) distances.set(s.id, metres);
			}
		}
	}
	if (cache.size > 10000) cache.clear();
	return { distances, approximate };
}
