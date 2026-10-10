import { distance } from "../transit/core";
import { getRides } from "../transit/server";
import type { Position } from "../transit/types";

export type ParkRideLot = Position & {
	id: string;
	name: string;
	spaces: number | null;
};
const LOTS_URL =
	"https://gis.vplanas.lt/arcgis/rest/services/Interaktyvus_zemelapis2/Transportas_public/MapServer/2/query?where=1%3D1&outFields=*&outSR=4326&f=geojson";
let lots: { value: ParkRideLot[]; at: number } | undefined;

/** Official "Statyk ir važiuok" (Park & Ride) lots from Vilnius open GIS data, cached for a day. */
export async function parkRideLots(): Promise<ParkRideLot[]> {
	if (lots && Date.now() - lots.at < 86_400_000) return lots.value;
	try {
		const response = await fetch(LOTS_URL, {
			headers: { "User-Agent": "MoveSmart/1.0" },
			signal: AbortSignal.timeout(10_000),
		});
		const data = (await response.json()) as {
			features: {
				id: number;
				geometry: { coordinates: [number, number] };
				properties: { Adresas?: string; Vietu_skaicius?: number | null };
			}[];
		};
		const value = data.features.map((f) => ({
			id: `pr-${f.id}`,
			name: f.properties.Adresas ?? "Park & Ride",
			spaces: f.properties.Vietu_skaicius ?? null,
			lon: f.geometry.coordinates[0],
			lat: f.geometry.coordinates[1],
		}));
		lots = { value, at: Date.now() };
		return value;
	} catch {
		return lots?.value ?? [];
	}
}

/** Lots worth driving to: roughly on the way, and leaving a real bus ride to the destination. */
export function lotsOnTheWay(from: Position, to: Position, all: ParkRideLot[]) {
	const direct = distance(from, to);
	if (direct < 3000) return [];
	return all
		.filter(
			(lot) =>
				distance(lot, to) >= 1500 &&
				distance(from, lot) >= 800 &&
				distance(from, lot) + distance(lot, to) <= direct * 1.35 + 1000,
		)
		.sort((a, b) => distance(from, a) - distance(from, b))
		.slice(0, 2);
}

/** Drive to a lot, park, then the best bus from there. */
export async function parkRideTrips(
	from: Position,
	to: Position,
	walkPace: number,
	maxWalk: number,
	at: number,
) {
	const candidates = lotsOnTheWay(from, to, await parkRideLots());
	const trips = await Promise.all(
		candidates.map(async (lot) => {
			const driveKm = (distance(from, lot) * 1.35) / 1000;
			// Drive plus a few minutes to park before the bus search starts.
			const ready = at + (Math.round((driveKm / 25) * 60) + 4) * 60_000;
			const { rides } = await getRides(lot, to, walkPace, maxWalk, ready);
			return rides[0] ? { lot, driveKm, ride: rides[0] } : null;
		}),
	);
	return trips.filter((t) => t !== null);
}
