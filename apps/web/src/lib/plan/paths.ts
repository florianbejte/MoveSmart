import type { Position } from "../transit/types";

export type PathProfile = "foot" | "bike" | "car";
type Path = { coordinates: [number, number][]; routed: boolean };
const cache = new Map<string, { path: Path; at: number }>();

/** Street-following geometry from the FOSSGIS OSRM servers, cached; straight line if routing fails. */
export async function getPath(
	profile: PathProfile,
	from: Position,
	to: Position,
): Promise<Path> {
	const key = `${profile}:${from.lat.toFixed(4)},${from.lon.toFixed(4)}:${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.path;
	let path: Path = {
		coordinates: [
			[from.lon, from.lat],
			[to.lon, to.lat],
		],
		routed: false,
	};
	try {
		const response = await fetch(
			`https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`,
			{
				headers: { "User-Agent": "MoveSmart/1.0 (Vilnius hackathon)" },
				signal: AbortSignal.timeout(8_000),
			},
		);
		const data = (await response.json()) as {
			code: string;
			routes?: { geometry: { coordinates: [number, number][] } }[];
		};
		const coordinates = data.routes?.[0]?.geometry.coordinates;
		if (data.code === "Ok" && coordinates?.length)
			path = { coordinates, routed: true };
	} catch {
		// Fall back to a straight line; the map labels it as approximate.
	}
	if (cache.size > 2000) cache.clear();
	cache.set(key, { path, at: Date.now() });
	return path;
}

/** The part of a trip shape between the boarding and alighting stops. */
export function sliceShape(
	shape: [number, number][],
	from: Position,
	to: Position,
): [number, number][] {
	if (shape.length < 2) return [];
	const nearest = (p: Position, start = 0) => {
		let best = start;
		let bestD = Number.POSITIVE_INFINITY;
		for (let i = start; i < shape.length; i++) {
			const d = (shape[i][0] - p.lon) ** 2 + (shape[i][1] - p.lat) ** 2;
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		return best;
	};
	const a = nearest(from);
	const b = nearest(to, a);
	return shape.slice(a, b + 1);
}
