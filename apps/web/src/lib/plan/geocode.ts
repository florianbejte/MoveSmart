import type { Position } from "../transit/types";

export type GeocodeHit = Position & {
	name: string;
	detail: string;
	kind: string;
};
type PhotonFeature = {
	geometry: { coordinates: [number, number] };
	properties: Record<string, string | undefined>;
};
// Results that are rarely what someone means by a destination.
const NOISE = new Set([
	"atm",
	"parcel_locker",
	"vending_machine",
	"bench",
	"waste_basket",
	"recycling",
	"post_box",
	"bicycle_parking",
	"construction",
	"defibrillator",
	"fire_hydrant",
	"telephone",
]);

/** Photon results reduced to distinct, readable Vilnius places. */
export function toHits(features: PhotonFeature[], query = ""): GeocodeHit[] {
	const seen = new Set<string>();
	const hits: GeocodeHit[] = [];
	// Someone typing a house number wants the address itself first, not the shops inside it.
	if (/\d/.test(query))
		for (const f of features) {
			const p = f.properties;
			if (!p.street || !p.housenumber) continue;
			const name = `${p.street} ${p.housenumber}`;
			const key = `address|${name}`.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			const [lon, lat] = f.geometry.coordinates;
			hits.push({
				name,
				detail: p.district || p.locality || "",
				kind: "address",
				lat,
				lon,
			});
		}
	for (const f of features) {
		const p = f.properties;
		if (p.osm_value && NOISE.has(p.osm_value)) continue;
		const address = [p.street, p.housenumber].filter(Boolean).join(" ");
		const name = p.name || address;
		if (!name) continue;
		const detail = [
			p.name && address ? address : "",
			p.district || p.locality || "",
			p.city && p.city !== "Vilnius" ? p.city : "",
		]
			.filter(Boolean)
			.join(", ");
		const key = p.name
			? `${name}|${detail}`.toLowerCase()
			: `address|${name}`.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const [lon, lat] = f.geometry.coordinates;
		hits.push({
			name,
			detail,
			kind: (p.osm_value ?? p.osm_key ?? "place").replace(/_/g, " "),
			lat,
			lon,
		});
	}
	return hits.slice(0, 6);
}

const cache = new Map<string, { hits: GeocodeHit[]; at: number }>();
/** Address and place search limited to Vilnius, via OpenStreetMap's Photon (made for search-as-you-type). */
export async function geocode(query: string): Promise<GeocodeHit[]> {
	const q = query.trim().replace(/\s+/g, " ").slice(0, 100);
	const key = q.toLocaleLowerCase("lt");
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.hits;
	const params = new URLSearchParams({
		q,
		limit: "12",
		bbox: "25.02,54.56,25.48,54.83",
		lat: "54.6872",
		lon: "25.2797",
	});
	const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
		headers: { "User-Agent": "MoveSmart/1.0 (Vilnius hackathon)" },
		signal: AbortSignal.timeout(6_000),
	});
	if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
	const hits = toHits(
		((await response.json()) as { features?: PhotonFeature[] }).features ?? [],
		q,
	);
	if (cache.size > 5000) cache.clear();
	cache.set(key, { hits, at: Date.now() });
	return hits;
}
