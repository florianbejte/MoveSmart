import { localParts } from "../transit/core";
import type { Departure } from "../transit/types";
import type { CrowdingSummary } from "./types";
export function reportForDeparture(
	reports: CrowdingSummary[],
	departure: Departure,
	now: number,
) {
	if (!departure.live || !departure.vehicleId) return undefined;
	return reports.find(
		(r) =>
			r.vehicleId === departure.vehicleId &&
			r.tripId === `${localParts(now).date}:${departure.tripId}` &&
			r.expiresAt > now,
	);
}
