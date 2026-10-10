import type { FeatureCollection, Point } from "geojson";
import { freshVehicle, localParts } from "../transit/core";
import type { Stop, Vehicle } from "../transit/types";
import { CROWDING, type ReportsFeed, STOP_ISSUES } from "./types";
export type CommunityProperties = {
	id: string;
	target: "stop" | "vehicle";
	title: string;
	description: string;
	updatedAt: number;
	count: number;
};
export type CommunityCollection = FeatureCollection<Point, CommunityProperties>;
export function communityFeatures(
	feed: ReportsFeed | undefined,
	stops: Stop[],
	vehicles: Vehicle[],
	now: number,
): CommunityCollection {
	const features: CommunityCollection["features"] = [];
	if (!feed) return { type: "FeatureCollection", features };
	for (const r of feed.reports) {
		const v = vehicles.find(
			(v) =>
				v.id === r.vehicleId &&
				`${localParts(now).date}:${v.tripId}` === r.tripId,
		);
		if (!v || !freshVehicle(v, now) || r.expiresAt <= now) continue;
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: [v.lon, v.lat] },
			properties: {
				id: v.id,
				target: "vehicle",
				title: `${v.route} → ${v.destination}`,
				description:
					CROWDING.find((c) => c.id === r.level)?.label ?? "Crowding",
				updatedAt: r.updatedAt,
				count: r.count,
			},
		});
	}
	const grouped = new Map<string, NonNullable<ReportsFeed["issues"]>>();
	for (const r of feed.issues ?? [])
		if (r.expiresAt > now)
			grouped.set(r.stopId, [...(grouped.get(r.stopId) ?? []), r]);
	for (const [id, issues] of grouped) {
		const stop = stops.find((s) => s.id === id);
		if (!stop) continue;
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
			properties: {
				id,
				target: "stop",
				title: stop.name,
				description: issues
					.map(
						(r) =>
							`${STOP_ISSUES.find((x) => x.id === r.kind)?.label}${r.route ? ` · Route ${r.route}` : ""}`,
					)
					.join(" · "),
				updatedAt: Math.max(...issues.map((r) => r.updatedAt)),
				count: issues.reduce((sum, r) => sum + r.count, 0),
			},
		});
	}
	return { type: "FeatureCollection", features };
}
