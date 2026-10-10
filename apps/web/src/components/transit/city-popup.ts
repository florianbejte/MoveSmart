import { dateLocale, t } from "@/lib/i18n/core";
import { CITY_LAYERS, type CityFeature } from "@/lib/transit/city";

const date = (value: number) =>
	new Intl.DateTimeFormat(dateLocale(), {
		timeZone: "Europe/Vilnius",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	}).format(value);

export function cityPopupContent(
	feature: CityFeature,
	pinned: boolean,
	stale: boolean,
) {
	const p = feature.properties;
	const layer = CITY_LAYERS.find((item) => item.id === p.category);
	const root = document.createElement("article");
	root.className = "city-map-detail";
	root.setAttribute("aria-label", `${t(layer?.label)}: ${p.title}`);
	const add = (tag: string, text: string, className = "") => {
		const element = document.createElement(tag);
		element.textContent = t(text);
		element.className = className;
		root.append(element);
		return element;
	};
	add("span", layer?.label ?? "City data", "eyebrow");
	add("h3", p.title);
	add("p", p.description || layer?.note || "");
	add(
		"small",
		`${p.timing}${p.start !== null ? ` · ${date(p.start)}` : ""}${p.end !== null ? ` → ${date(p.end)}` : ""}`,
	);
	if (p.routes.length) add("p", `Reported routes: ${p.routes.join(", ")}`);
	if (stale)
		add(
			"p",
			"Updates delayed; these details may be outdated.",
			"city-popup-warning",
		);
	if (pinned) {
		const link = document.createElement("a");
		link.textContent = t("View source ↗");
		link.href = p.source;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		root.append(link);
	} else add("small", "Click to keep open", "city-popup-hint");
	return root;
}
