import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Crowding, CrowdingSummary } from "./types";
import {
	issueKey,
	issueTTL,
	REPORT_TTL,
	type StopIssue,
	type StopIssueSummary,
} from "./types";
export type Report = {
	reporter: string;
	vehicleId: string;
	tripId: string;
	level: Crowding;
	createdAt: number;
};
export function activeReports(reports: Report[], now: number) {
	return reports.filter(
		(r) => r.createdAt <= now && now - r.createdAt < REPORT_TTL,
	);
}
export function summaries(reports: Report[], now: number): CrowdingSummary[] {
	const groups = new Map<string, Report[]>();
	for (const report of activeReports(reports, now)) {
		const key = JSON.stringify([report.vehicleId, report.tripId]);
		groups.set(key, [...(groups.get(key) ?? []), report]);
	}
	return [...groups.values()].map((group) => {
		const latest = group.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
		return {
			vehicleId: latest.vehicleId,
			tripId: latest.tripId,
			level: latest.level,
			updatedAt: latest.createdAt,
			expiresAt: latest.createdAt + REPORT_TTL,
			count: group.filter((r) => r.level === latest.level).length,
		};
	});
}
export function insertReport(reports: Report[], report: Report) {
	const active = activeReports(reports, report.createdAt);
	if (
		active.some(
			(r) =>
				r.reporter === report.reporter &&
				report.createdAt - r.createdAt < 30000,
		)
	)
		throw new Error("Please wait 30 seconds before reporting again.");
	return [
		...active.filter(
			(r) =>
				!(
					r.reporter === report.reporter &&
					r.vehicleId === report.vehicleId &&
					r.tripId === report.tripId
				),
		),
		report,
	];
}
function directory() {
	if (process.env.REPORTS_DATA_DIR) return process.env.REPORTS_DATA_DIR;
	if (process.env.NODE_ENV === "production")
		throw new Error("Persistent report storage is not configured.");
	return path.join(process.cwd(), ".local-reports");
}
const state = globalThis as typeof globalThis & {
	movesmartReportWrite?: Promise<void>;
};
async function read(): Promise<Report[]> {
	try {
		return JSON.parse(
			await readFile(path.join(directory(), "crowding.json"), "utf8"),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}
export async function getReports() {
	await state.movesmartReportWrite;
	return read();
}
export async function saveReport(report: Report, confirming = false) {
	const work = (state.movesmartReportWrite ?? Promise.resolve()).then(
		async () => {
			const dir = directory();
			const old = await read();
			if (
				confirming &&
				!summaries(old, report.createdAt).some(
					(r) =>
						r.vehicleId === report.vehicleId &&
						r.tripId === report.tripId &&
						r.level === report.level,
				)
			)
				throw new Error(
					"The crowding report changed or expired. Refresh before confirming.",
				);
			const records = insertReport(old, report);
			await mkdir(dir, { recursive: true });
			const file = path.join(dir, "crowding.json");
			await writeFile(`${file}.tmp`, JSON.stringify(records), { mode: 0o600 });
			await rename(`${file}.tmp`, file);
		},
	);
	state.movesmartReportWrite = work.catch(() => {});
	await work;
}

export function issueSummaries(
	records: StopIssue[],
	now: number,
): StopIssueSummary[] {
	const groups = new Map<string, StopIssue[]>();
	for (const r of records.filter(
		(r) => r.createdAt <= now && now - r.createdAt < issueTTL(r.kind),
	)) {
		const key = issueKey(r);
		groups.set(key, [...(groups.get(key) ?? []), r]);
	}
	return [...groups.entries()].map(([id, group]) => {
		const latest = group.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
		return {
			id,
			stopId: latest.stopId,
			kind: latest.kind,
			vehicleId: latest.vehicleId,
			tripId: latest.tripId,
			route: latest.route,
			updatedAt: latest.createdAt,
			expiresAt: latest.createdAt + issueTTL(latest.kind),
			count: new Set(group.map((r) => r.reporter)).size,
		};
	});
}
async function readIssues(): Promise<StopIssue[]> {
	try {
		return JSON.parse(
			await readFile(path.join(directory(), "issues.json"), "utf8"),
		);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw e;
	}
}
export async function getIssues() {
	await state.movesmartReportWrite;
	return readIssues();
}
export function insertIssue(records: StopIssue[], report: StopIssue) {
	const active = records.filter(
		(r) =>
			r.createdAt <= report.createdAt &&
			report.createdAt - r.createdAt < issueTTL(r.kind),
	);
	if (
		active.some(
			(r) =>
				r.reporter === report.reporter &&
				report.createdAt - r.createdAt < 30000,
		)
	)
		throw new Error("Please wait 30 seconds before reporting again.");
	return [
		...active.filter(
			(r) =>
				!(r.reporter === report.reporter && issueKey(r) === issueKey(report)),
		),
		report,
	];
}
export async function saveIssue(report: StopIssue, confirmationId?: string) {
	const work = (state.movesmartReportWrite ?? Promise.resolve()).then(
		async () => {
			const old = await readIssues();
			if (
				confirmationId &&
				!issueSummaries(old, report.createdAt).some(
					(r) => r.id === confirmationId,
				)
			)
				throw new Error("This report has expired. Refresh and try again.");
			const records = insertIssue(old, report);
			const dir = directory();
			await mkdir(dir, { recursive: true });
			const file = path.join(dir, "issues.json");
			await writeFile(`${file}.tmp`, JSON.stringify(records), { mode: 0o600 });
			await rename(`${file}.tmp`, file);
		},
	);
	state.movesmartReportWrite = work.catch(() => {});
	await work;
}
