import { officialDisruptions } from "@/lib/plan/official-disruptions";
import { getWeather } from "@/lib/plan/weather";
import { getRides } from "@/lib/transit/server";

export const runtime = "nodejs";
const point = (value: string | null) => {
	const [lat, lon] = (value ?? "").split(",").map(Number);
	// Roughly the Vilnius region; anything else is a mistake or abuse.
	return lat > 54.4 && lat < 54.95 && lon > 24.9 && lon < 25.65
		? { lat, lon }
		: null;
};
export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const from = point(params.get("from"));
	const to = point(params.get("to"));
	const maxWalk = Math.min(30, Math.max(5, Number(params.get("walk")) || 20));
	const pace = Number(params.get("pace")) || 75;
	if (!from || !to)
		return Response.json(
			{ error: "Give from and to as lat,lon inside Vilnius." },
			{ status: 400 },
		);
	try {
		// Conditions load independently so a slow ArcGIS feed cannot hold up routes.
		if (params.get("part") === "conditions") {
			const [weather, disruptions] = await Promise.all([
				getWeather(),
				officialDisruptions(from, to).catch(() => []),
			]);
			return Response.json(
				{ weather, disruptions },
				{ headers: { "Cache-Control": "no-store" } },
			);
		}
		const transit = await getRides(
			from,
			to,
			Math.min(90, Math.max(40, pace)),
			maxWalk,
		);
		return Response.json(transit, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		console.error(
			"Trip planning unavailable",
			error instanceof Error ? error.message : "Unknown error",
		);
		return Response.json(
			{ error: "Trip planning is temporarily unavailable." },
			{ status: 503, headers: { "Retry-After": "15" } },
		);
	}
}
