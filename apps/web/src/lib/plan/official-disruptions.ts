import type { Geometry } from "geojson";
import { getCityLayer } from "../transit/city-server";
import type { Position } from "../transit/types";
import { type Disruption, distanceToSegment } from "./disruptions";

/** A representative point for a city feature: the point itself or a polygon's centre. */
function anchor(geometry: Geometry): Position | null {
	const ring = (coords: number[][]) => ({
		lon: coords.reduce((s, c) => s + c[0], 0) / coords.length,
		lat: coords.reduce((s, c) => s + c[1], 0) / coords.length,
	});
	switch (geometry.type) {
		case "Point":
			return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
		case "Polygon":
			return ring(geometry.coordinates[0]);
		case "MultiPolygon":
			return ring(geometry.coordinates[0][0]);
		case "LineString":
			return ring(geometry.coordinates);
		default:
			return null;
	}
}

const KINDS = {
	restrictions: "closure",
	roadworks: "roadworks",
	incidents: "transit",
} as const;

/** Official closures, roadworks and transit incidents within ~2 km of the trip's direct line. */
export async function officialDisruptions(
	from: Position,
	to: Position,
): Promise<Disruption[]> {
	const layers = await Promise.allSettled(
		(Object.keys(KINDS) as (keyof typeof KINDS)[]).map(async (layer) => ({
			layer,
			feed: await getCityLayer(layer),
		})),
	);
	return layers.flatMap((result) => {
		if (result.status !== "fulfilled") return [];
		const { layer, feed } = result.value;
		return feed.collection.features.flatMap((f): Disruption[] => {
			const at = anchor(f.geometry);
			if (!at || distanceToSegment(at, from, to) > 2000) return [];
			const p = f.properties;
			return [
				{
					...at,
					id: `${layer}:${p.id}`,
					kind: KINDS[layer],
					title: p.title,
					detail: p.description,
					start: p.start,
					end: p.end,
					source: "official",
					routes: p.routes,
				},
			];
		});
	});
}
