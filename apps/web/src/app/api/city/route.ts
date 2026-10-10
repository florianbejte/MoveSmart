import { isCityLayer } from "@/lib/transit/city";
import { getCityLayer } from "@/lib/transit/city-server";
export const runtime = "nodejs";
export async function GET(request: Request) {
	const layer = new URL(request.url).searchParams.get("layer");
	if (!isCityLayer(layer))
		return Response.json({ error: "Unknown city layer." }, { status: 400 });
	try {
		return Response.json(await getCityLayer(layer), {
			headers: { "Cache-Control": "no-store" },
		});
	} catch {
		return Response.json(
			{ error: "City data is temporarily unavailable." },
			{
				status: 503,
				headers: { "Cache-Control": "no-store", "Retry-After": "30" },
			},
		);
	}
}
