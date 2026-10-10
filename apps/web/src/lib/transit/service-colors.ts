import type { TransitRoute } from "./types";

export const SERVICE_COLORS = {
	express: "#008000",
	bus: "#0073AC",
	trolleybus: "#DC3131",
	night: "#000000",
	river: "#00A59B",
} as const;

// Shared by GPS markers and GTFS route badges, including unmatched GPS routes.
export function serviceColor(
	name: string,
	mode?: TransitRoute["mode"],
	publishedColor?: string,
): string {
	if (publishedColor && /^#[a-f\d]{6}$/i.test(publishedColor))
		return publishedColor;
	const route = name.trim().toUpperCase();
	if (route === "L1") return SERVICE_COLORS.river;
	if (/^N[1-9]$/.test(route)) return SERVICE_COLORS.night;
	if (mode === "trolleybus") return SERVICE_COLORS.trolleybus;
	if (/^[1-6]G(?:-A)?$/.test(route)) return SERVICE_COLORS.express;
	return SERVICE_COLORS.bus;
}
