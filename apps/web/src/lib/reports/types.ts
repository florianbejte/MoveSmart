export const CROWDING = [
	{
		id: "seats",
		label: "Seats available",
		description: "Room to sit and settle in.",
		color: "#25824c",
	},
	{
		id: "standing",
		label: "Standing room",
		description: "Seats are mostly taken.",
		color: "#a56510",
	},
	{
		id: "full",
		label: "Very crowded",
		description: "Little room to move or board.",
		color: "#ce343b",
	},
] as const;
export type Crowding = (typeof CROWDING)[number]["id"];
export type CrowdingSummary = {
	vehicleId: string;
	tripId: string;
	level: Crowding;
	updatedAt: number;
	expiresAt: number;
	count: number;
};
export type ReportsFeed = {
	reports: CrowdingSummary[];
	issues: StopIssueSummary[];
};
export const REPORT_TTL = 15 * 60 * 1000;
export function isCrowding(value: unknown): value is Crowding {
	return CROWDING.some((x) => x.id === value);
}

export const STOP_ISSUES = [
	{ id: "shelter", label: "Damaged shelter" },
	{ id: "access", label: "Blocked access" },
	{ id: "timetable", label: "Missing timetable" },
	{ id: "moved", label: "Stop moved" },
	{ id: "passed-full", label: "Too full to board" },
	{ id: "passed-skip", label: "Bus didn’t stop" },
] as const;
export type StopIssueKind = (typeof STOP_ISSUES)[number]["id"];
export type StopIssue = {
	reporter: string;
	stopId: string;
	kind: StopIssueKind;
	vehicleId?: string;
	tripId?: string;
	route?: string;
	createdAt: number;
};
export type StopIssueSummary = Omit<StopIssue, "reporter" | "createdAt"> & {
	id: string;
	updatedAt: number;
	expiresAt: number;
	count: number;
};
export function isStopIssue(value: unknown): value is StopIssueKind {
	return STOP_ISSUES.some((x) => x.id === value);
}
export function issueTTL(kind: StopIssueKind) {
	return kind.startsWith("passed-") ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000;
}
export function issueKey(
	issue: Pick<StopIssue, "stopId" | "kind" | "vehicleId" | "tripId">,
) {
	return JSON.stringify([
		issue.stopId,
		issue.kind,
		issue.vehicleId ?? null,
		issue.tripId ?? null,
	]);
}
