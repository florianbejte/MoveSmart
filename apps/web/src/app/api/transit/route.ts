import {
	getEnrichedLive,
	getSchedule,
	getStopBoard,
	getTrip,
} from "@/lib/transit/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const kind = searchParams.get("kind");
	const id = searchParams.get("id");
	try {
		let result: unknown;
		if (kind === "network") result = (await getSchedule()).network;
		else if (kind === "vehicles") result = await getEnrichedLive();
		else if (kind === "stop" && id) result = await getStopBoard(id);
		else if (kind === "trip" && id) result = await getTrip(id);
		else
			return Response.json(
				{
					error:
						"Choose network, vehicles, stop or trip; stop and trip require an id.",
				},
				{ status: 400 },
			);
		if (!result)
			return Response.json(
				{ error: "Transit item not found." },
				{ status: 404 },
			);
		return Response.json(result, {
			headers: {
				"Cache-Control":
					kind === "network" ? "public, max-age=300" : "no-store",
			},
		});
	} catch (error) {
		console.error(
			"Transit feed unavailable",
			error instanceof Error ? error.message : "Unknown error",
		);
		return Response.json(
			{
				error:
					"Vilnius transit data is temporarily unavailable. Please try again.",
			},
			{
				status: 503,
				headers: { "Cache-Control": "no-store", "Retry-After": "15" },
			},
		);
	}
}
