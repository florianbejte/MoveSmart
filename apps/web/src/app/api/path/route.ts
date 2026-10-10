import { getPath, type PathProfile } from "@/lib/plan/paths";

export const runtime = "nodejs";
const PROFILES = new Set<PathProfile>(["foot", "bike", "car"]);
const point = (value: string | null) => {
	const [lat, lon] = (value ?? "").split(",").map(Number);
	return lat > 54.4 && lat < 54.95 && lon > 24.9 && lon < 25.65
		? { lat, lon }
		: null;
};
export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const profile = params.get("profile") as PathProfile;
	const from = point(params.get("from"));
	const to = point(params.get("to"));
	if (!PROFILES.has(profile) || !from || !to)
		return Response.json(
			{
				error: "Give profile (foot, bike or car), from and to inside Vilnius.",
			},
			{ status: 400 },
		);
	return Response.json(await getPath(profile, from, to), {
		headers: { "Cache-Control": "public, max-age=3600" },
	});
}
