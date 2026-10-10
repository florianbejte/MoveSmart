import { dateLocale, t } from "@/lib/i18n/core";
import { freshVehicle } from "@/lib/transit/core";
import type { Vehicle } from "@/lib/transit/types";

export function vehiclePopupContent(
	vehicle: Vehicle,
	now: number,
	feedStale: boolean,
) {
	const root = document.createElement("article");
	root.className = "city-map-detail";
	root.setAttribute("role", "tooltip");
	const add = (tag: string, text: string) => {
		const node = document.createElement(tag);
		node.textContent = t(text);
		root.append(node);
	};
	const fresh = freshVehicle(vehicle, now) && !feedStale;
	add(
		"span",
		`${vehicle.mode === "trolleybus" ? "Trolleybus" : "Bus"} ${vehicle.route} · Vehicle ${vehicle.number}`,
	);
	add("h3", vehicle.destination || "Destination unavailable");
	const delay =
		!fresh || vehicle.delay === null
			? "Schedule deviation unavailable"
			: Math.abs(vehicle.delay) < 60
				? "On time"
				: `${Math.round(Math.abs(vehicle.delay) / 60)} min ${vehicle.delay > 0 ? "late" : "early"}`;
	add("p", `${fresh ? "Live" : "Older position"} · ${delay}`);
	add("p", `${fresh ? "Speed" : "Last reported speed"}: ${vehicle.speed} km/h`);
	add(
		"small",
		`Position updated ${new Intl.DateTimeFormat(dateLocale(), { timeZone: "Europe/Vilnius", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(vehicle.measuredAt)}`,
	);
	add("small", "Click for route and stops");
	return root;
}
