import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	activeReports,
	getIssues,
	getReports,
	insertIssue,
	insertReport,
	issueSummaries,
	type Report,
	saveIssue,
	saveReport,
	summaries,
} from "./store";
import { issueTTL, REPORT_TTL, type StopIssue } from "./types";

const now = 1800000000000;
const record: Report = {
	reporter: "device-a",
	vehicleId: "bus-12",
	tripId: "20261010:trip-1",
	level: "seats",
	createdAt: now,
};
test("crowding expires, rejects future timestamps and separates vehicles and trips", () => {
	assert.equal(activeReports([record], now + REPORT_TTL).length, 0);
	assert.equal(activeReports([record], now - 1).length, 0);
	const result = summaries(
		[
			record,
			{ ...record, vehicleId: "bus-13" },
			{ ...record, tripId: "20261010:trip-2" },
		],
		now,
	);
	assert.equal(result.length, 3);
	assert.equal("reporter" in result[0], false);
});
test("repeat submissions are throttled, updates replace votes, and newest condition wins", () => {
	assert.throws(
		() => insertReport([record], { ...record, createdAt: now + 1000 }),
		/30 seconds/,
	);
	const updated = insertReport([record], {
		...record,
		level: "full",
		createdAt: now + 31000,
	});
	assert.equal(updated.length, 1);
	const result = summaries(
		[
			...updated,
			{
				...record,
				reporter: "device-b",
				level: "standing",
				createdAt: now + 32000,
			},
		],
		now + 32000,
	)[0];
	assert.equal(result.level, "standing");
	assert.equal(result.count, 1);
});
test("server reports persist on disk and concurrent submissions are not lost", async () => {
	const previous = process.env.REPORTS_DATA_DIR;
	const dir = await mkdtemp(path.join(tmpdir(), "movesmart-reports-test-"));
	process.env.REPORTS_DATA_DIR = dir;
	try {
		await Promise.all([
			saveReport(record),
			saveReport({ ...record, reporter: "device-b" }),
		]);
		assert.equal((await getReports()).length, 2);
		assert.equal(summaries(await getReports(), now)[0].count, 2);
		await assert.rejects(
			saveReport({ ...record, reporter: "c", level: "full" }, true),
			/changed or expired/,
		);
		const issue: StopIssue = {
			reporter: "a",
			stopId: "s",
			kind: "access",
			createdAt: now,
		};
		await Promise.all([
			saveIssue(issue),
			saveIssue({ ...issue, reporter: "b" }),
		]);
		const summary = issueSummaries(await getIssues(), now)[0];
		assert.equal(summary.count, 2);
		await assert.rejects(
			saveIssue(
				{ ...issue, reporter: "c", createdAt: now + issueTTL("access") },
				summary.id,
			),
			/expired/,
		);
		assert.equal((await getIssues()).length, 2);
	} finally {
		if (previous === undefined) delete process.env.REPORTS_DATA_DIR;
		else process.env.REPORTS_DATA_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("stop issues expire by category and confirmations count distinct devices", () => {
	const issue: StopIssue = {
		reporter: "a",
		stopId: "s",
		kind: "shelter",
		createdAt: now,
	};
	assert.equal(issueSummaries([issue], now + issueTTL("shelter")).length, 0);
	assert.equal(issueSummaries([issue], now - 1).length, 0);
	assert.equal(
		issueSummaries([{ ...issue, kind: "passed-skip" }], now + 1800000).length,
		0,
	);
	const updated = insertIssue([issue], { ...issue, createdAt: now + 31000 });
	assert.equal(updated.length, 1);
	const result = issueSummaries(
		[...updated, { ...issue, reporter: "b", createdAt: now + 31000 }],
		now + 31000,
	)[0];
	assert.equal(result.count, 2);
	assert.equal("reporter" in result, false);
	assert.throws(
		() =>
			insertIssue([issue], { ...issue, kind: "access", createdAt: now + 1000 }),
		/30 seconds/,
	);
	const passed = {
		...issue,
		kind: "passed-skip" as const,
		vehicleId: "bus-1",
		tripId: "trip-1",
	};
	assert.equal(
		issueSummaries(
			[passed, { ...passed, tripId: "trip-2" }, { ...passed, stopId: "s2" }],
			now,
		).length,
		3,
	);
});
