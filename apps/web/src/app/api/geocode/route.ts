import { geocode } from "@/lib/plan/geocode";

export const runtime = "nodejs";
export async function GET(request: Request) {
	const q = new URL(request.url).searchParams.get("q") ?? "";
	if (q.trim().length < 3)
		return Response.json(
			{ error: "Type at least 3 characters." },
			{ status: 400 },
		);
	try {
		return Response.json(
			{ hits: await geocode(q) },
			{ headers: { "Cache-Control": "public, max-age=3600" } },
		);
	} catch (error) {
		console.error(
			"Geocoding unavailable",
			error instanceof Error ? error.message : "Unknown error",
		);
		return Response.json(
			{ error: "Address search is temporarily unavailable." },
			{ status: 503 },
		);
	}
}
