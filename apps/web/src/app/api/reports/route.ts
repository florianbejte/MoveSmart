import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import {
	getIssues,
	getReports,
	issueSummaries,
	saveIssue,
	saveReport,
	summaries,
} from "@/lib/reports/store";
import { isCrowding, isStopIssue } from "@/lib/reports/types";
import { distance, freshVehicle, localParts } from "@/lib/transit/core";
import { getEnrichedLive, getSchedule, getTrip } from "@/lib/transit/server";
import type { Vehicle } from "@/lib/transit/types";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
	try {
		return Response.json(
			{
				reports: summaries(await getReports(), Date.now()),
				issues: issueSummaries(await getIssues(), Date.now()),
			},
			{ headers },
		);
	} catch {
		return Response.json(
			{ error: "Community reports are temporarily unavailable." },
			{ status: 503, headers },
		);
	}
}
export async function POST(request: Request) {
	if (request.headers.get("origin") !== new URL(request.url).origin)
		return Response.json(
			{ error: "Please report from this site." },
			{ status: 403, headers },
		);
	if (Number(request.headers.get("content-length")) > 2048)
		return Response.json(
			{ error: "Report is too large." },
			{ status: 413, headers },
		);
	let body: {
		vehicleId?: unknown;
		tripId?: unknown;
		level?: unknown;
		kind?: unknown;
		stopId?: unknown;
		confirmId?: unknown;
		confirm?: unknown;
	};
	try {
		const raw = await request.text();
		if (raw.length > 2048) throw new Error();
		body = JSON.parse(raw);
	} catch {
		return Response.json(
			{ error: "Invalid report." },
			{ status: 400, headers },
		);
	}
	if (!body || typeof body !== "object")
		return Response.json(
			{ error: "Invalid report." },
			{ status: 400, headers },
		);
	const jar = await cookies();
	const existing = jar.get("movesmart-reporter")?.value;
	const reporter =
		existing && /^[a-f\d-]{36}$/i.test(existing) ? existing : randomUUID();
	jar.set("movesmart-reporter", reporter, {
		httpOnly: true,
		sameSite: "strict",
		secure: new URL(request.url).protocol === "https:",
		path: "/",
		maxAge: 86400 * 30,
	});
	if (body.kind !== undefined || body.confirmId !== undefined) {
		try {
			const now = Date.now();
			if (typeof body.confirmId === "string") {
				const found = issueSummaries(await getIssues(), now).find(
					(r) => r.id === body.confirmId,
				);
				if (!found)
					return Response.json(
						{ error: "This report has expired. Refresh and try again." },
						{ status: 409, headers },
					);
				await saveIssue(
					{
						reporter,
						stopId: found.stopId,
						kind: found.kind,
						vehicleId: found.vehicleId,
						tripId: found.tripId,
						route: found.route,
						createdAt: now,
					},
					found.id,
				);
			} else {
				if (!isStopIssue(body.kind) || typeof body.stopId !== "string")
					return Response.json(
						{ error: "Choose a stop and issue." },
						{ status: 400, headers },
					);
				const stop = (await getSchedule()).network.stops.find(
					(s) => s.id === body.stopId,
				);
				if (!stop)
					return Response.json(
						{ error: "Stop not found." },
						{ status: 404, headers },
					);
				let vehicle: Vehicle | undefined;
				if (body.kind.startsWith("passed-")) {
					const feed = await getEnrichedLive();
					vehicle = feed.vehicles.find((v) => v.id === body.vehicleId);
					const trip = vehicle?.tripId ? await getTrip(vehicle.tripId) : null;
					if (
						feed.stale ||
						!vehicle ||
						!freshVehicle(vehicle, now) ||
						!vehicle.tripId ||
						vehicle.tripId !== body.tripId ||
						distance(vehicle, stop) > 1000 ||
						!trip?.stops.some((s) => s.id === stop.id)
					)
						return Response.json(
							{
								error:
									"Choose a live bus serving this stop within 1 km. Its trip may have changed.",
							},
							{ status: 409, headers },
						);
				}
				await saveIssue({
					reporter,
					stopId: stop.id,
					kind: body.kind,
					vehicleId: vehicle?.id,
					tripId: vehicle?.tripId
						? `${localParts(now).date}:${vehicle.tripId}`
						: undefined,
					route: vehicle?.route,
					createdAt: now,
				});
			}
			return Response.json({ ok: true }, { headers });
		} catch (e) {
			const message = e instanceof Error ? e.message : "";
			const limited = message.startsWith("Please wait");
			const expired = message.startsWith("This report");
			return Response.json(
				{
					error:
						limited || expired
							? message
							: "Could not save your report. Please try again.",
				},
				{ status: limited ? 429 : expired ? 409 : 503, headers },
			);
		}
	}
	if (
		typeof body.vehicleId !== "string" ||
		typeof body.tripId !== "string" ||
		!isCrowding(body.level)
	)
		return Response.json(
			{ error: "Choose a vehicle and crowding level." },
			{ status: 400, headers },
		);

	try {
		const feed = await getEnrichedLive();
		const now = Date.now();
		const vehicle = feed.vehicles.find((v) => v.id === body.vehicleId);
		if (
			feed.stale ||
			!vehicle ||
			!freshVehicle(vehicle, now) ||
			!vehicle.tripId ||
			vehicle.tripId !== body.tripId
		)
			return Response.json(
				{
					error:
						"This trip has changed or is no longer live. Select the bus again.",
				},
				{ status: 409, headers },
			);
		await saveReport(
			{
				reporter,
				vehicleId: vehicle.id,
				tripId: `${localParts(now).date}:${vehicle.tripId}`,
				level: body.level,
				createdAt: now,
			},
			body.confirm === true,
		);
		return Response.json({ ok: true }, { headers });
	} catch (error) {
		const changed =
			error instanceof Error && error.message.startsWith("The crowding report");
		const rateLimited =
			error instanceof Error && error.message.startsWith("Please wait");
		return Response.json(
			{
				error:
					rateLimited || changed
						? (error as Error).message
						: "Could not save your report. Please try again.",
			},
			{ status: rateLimited ? 429 : changed ? 409 : 503, headers },
		);
	}
}
