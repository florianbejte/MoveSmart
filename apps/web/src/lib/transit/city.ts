import type { Feature, FeatureCollection, Geometry } from "geojson";

export const SHELTER_SOURCE =
	"https://open.geodata.gov.lt/datasets/8a1e4b06ca714e2983b67c737c667abe_0/";
export const BIKE_SOURCE =
	"https://gis.ktvis.lt/arcgis/rest/services/LAKD/Nac_taku_pletra/MapServer/11";
export const CITY_LAYERS = [
	{
		id: "bikes",
		label: "Bike lanes & paths",
		color: "#087f8c",
		note: "KTVIS existing municipal paths in Vilnius. May include shared paths; coverage and current condition are not guaranteed. Planned paths are excluded.",
	},
	{
		id: "shelters",
		label: "Civil-protection shelters",
		color: "#a74716",
		note: "Priedangos across Lithuania. Published capacity and access information; no live occupancy or opening status.",
	},
	{
		id: "incidents",
		label: "Transit alerts",
		color: "#b63e43",
		note: "Published transit disruptions and affected route numbers.",
	},
	{
		id: "roadworks",
		label: "Roadworks",
		color: "#b76916",
		note: "Roadwork locations and affected areas.",
	},
	{
		id: "restrictions",
		label: "Restrictions",
		color: "#8753b2",
		note: "Road closures and traffic restrictions.",
	},
	{
		id: "congestion",
		label: "Congestion & road load",
		color: "#bd6427",
		note: "Reported congestion and road-load values. Measurement time and load units are not supplied.",
	},
	{
		id: "parking",
		label: "Parking zones",
		color: "#3479be",
		note: "Zone boundaries only; no space availability or prices.",
	},
	{
		id: "signals",
		label: "Traffic lights",
		color: "#495c79",
		note: "Signal-controlled intersections; no live light phases.",
	},
	{
		id: "corridors",
		label: "Green corridors",
		color: "#268a6b",
		note: "Coordinated traffic-light corridors; infrastructure, not live phases.",
	},
] as const;
export type CityLayerId = (typeof CITY_LAYERS)[number]["id"];
export type CityProperties = {
	id: string;
	category: CityLayerId;
	title: string;
	description: string;
	routes: string[];
	start: number | null;
	end: number | null;
	timing: string;
	color: string;
	source: string;
};
export type CityFeature = Feature<Geometry, CityProperties>;
export type CityCollection = FeatureCollection<Geometry, CityProperties>;
export type CityFeed = {
	collection: CityCollection;
	fetchedAt: number;
	stale: boolean;
	unavailable: number;
};
export const EMPTY_CITY: CityCollection = {
	type: "FeatureCollection",
	features: [],
};
export function isCityLayer(value: string | null): value is CityLayerId {
	return CITY_LAYERS.some((layer) => layer.id === value);
}
export function routeTokens(value: unknown): string[] {
	return typeof value === "string"
		? [
				...new Set(
					value
						.toUpperCase()
						.match(/\b(?:N\d{1,3}|\d{1,3}[A-Z]?(?:-[A-Z])?)\b/g) ?? [],
				),
			]
		: [];
}
export function eventStillRelevant(p: CityProperties, now: number) {
	return p.end === null || p.end > now;
}
export function matchesRoutes(feature: CityFeature, names: string[]) {
	return feature.properties.routes.some((route) =>
		names.some((name) => name.toUpperCase() === route),
	);
}

// Whitelist public fields; never pass upstream attributes through to the browser.
export function normaliseCityFeature(
	feature: Feature,
	category: CityLayerId,
	source: string,
	now: number,
): CityFeature | null {
	if (!feature.geometry) return null;
	const p = Object.fromEntries(
		Object.entries(feature.properties ?? {}).map(([k, v]) => [
			k.toLowerCase().replaceAll("_", ""),
			v,
		]),
	);
	const text = (key: string) =>
		typeof p[key] === "string"
			? p[key]
					.replace(/<[^>]*>/g, "")
					.trim()
					.slice(0, 2000)
			: "";
	const timestamp = (key: string) =>
		typeof p[key] === "number" && Number.isFinite(p[key]) && p[key] > 0
			? (p[key] as number)
			: null;
	const config = CITY_LAYERS.find((layer) => layer.id === category);
	if (!config) return null;
	const isEvent =
		["incidents", "roadworks", "restrictions", "congestion"].includes(
			category,
		) && !("apkrovimas" in p);
	const start = isEvent
		? (timestamp("eventperformfromdate") ?? timestamp("eventshowfromdate"))
		: null;
	const end = isEvent
		? (timestamp("eventperformtodate") ?? timestamp("eventshowtodate"))
		: null;
	const showFrom = timestamp("eventshowfromdate");
	const showTo = timestamp("eventshowtodate");
	if (
		isEvent &&
		((p.visible !== null &&
			p.visible !== undefined &&
			Number(p.visible) === 0) ||
			(end !== null && end <= now) ||
			(showFrom !== null && showFrom > now) ||
			(showTo !== null && showTo <= now))
	)
		return null;
	const repeated = Number(p.repeatable) === 1 || Number(p.repeatableshow) === 1;
	let timing = isEvent
		? repeated
			? "Recurring · see published period"
			: start !== null && start > now
				? "Planned"
				: start !== null && end !== null
					? "Within published period"
					: "Timing unconfirmed"
		: "Infrastructure";
	let title =
		text("placedescription") ||
		text("pavadinima") ||
		text("pavadinimas") ||
		text("korpavad") ||
		config.label;
	let description = [text("eventdescription"), text("ptadditionalinfo")]
		.filter(Boolean)
		.join(" · ");
	let color: string = config.color;
	if (category === "bikes") {
		if (!["LineString", "MultiLineString"].includes(feature.geometry.type))
			return null;
		title = "Vilnius cycling path";
		const length = p.shapelength;
		description = [
			text("b1"),
			typeof length === "number" && Number.isFinite(length) && length > 0
				? `Mapped segment: ${Math.round(length)} m`
				: "",
			"Published as an existing municipal path. May be shared with pedestrians; current access and condition are not provided.",
		]
			.filter(Boolean)
			.join("\n");
		timing = "Infrastructure · update date not provided";
	}
	if (category === "parking") {
		const zones: Record<string, [string, string]> = {
			Geltona: ["Yellow", "#d0a31b"],
			Melyna: ["Blue", "#3479be"],
			Mėlyna: ["Blue", "#3479be"],
			Raudona: ["Red", "#cc5151"],
			Zalia: ["Green", "#379858"],
			Žalia: ["Green", "#379858"],
		};
		const zone = zones[text("zona")];
		title = `${zone?.[0] ?? (text("zona") || "Parking")} zone`;
		color = zone?.[1] ?? color;
	}
	if ("apkrovimas" in p) {
		timing = "Measurement time unavailable";
		description = `Reported road load: ${typeof p.apkrovimas === "number" ? p.apkrovimas : "unavailable"}. Units and measurement time are not supplied.`;
	}
	if (category === "signals")
		description = [text("numeris"), text("valdymometodas")]
			.filter(Boolean)
			.join(" · ");
	if (category === "shelters") {
		const positive = (key: string) =>
			typeof p[key] === "number" && Number.isFinite(p[key]) && p[key] > 0
				? p[key]
				: null;
		const flag = (key: string) =>
			p[key] === 1 ? "Yes" : p[key] === 0 ? "No" : "Not reported";
		const updated = timestamp("atnaujinimodata");
		title = text("pavadinimas") || "Civil-protection shelter";
		description = [
			[
				text("gatve"),
				text("namonumeris"),
				text("gyvenviete"),
				text("savivaldybe") !== text("gyvenviete") ? text("savivaldybe") : "",
			]
				.filter(Boolean)
				.join(" "),
			`Published capacity: ${positive("gyventojuskaicius") ?? "Not reported"}${positive("gyventojuskaicius") ? " people" : ""}`,
			`Adapted for people with disabilities: ${flag("pritaikytaasmenimssunegalia")}`,
			`24-hour entry: ${flag("patekimasvisapara")}`,
			text("darbovalandos") && `Entry hours: ${text("darbovalandos")}`,
			positive("plotas") && `Area: ${positive("plotas")} m²`,
			text("pastabos"),
			updated &&
				`Record updated: ${new Date(updated).toISOString().slice(0, 10)}`,
		]
			.filter(Boolean)
			.join("\n");
		timing = "Published information · live access and occupancy unknown";
	}
	const id = `${source}/${String(p.objectid1 ?? p.objectid ?? feature.id ?? "")}`;
	return {
		type: "Feature",
		id,
		geometry: feature.geometry,
		properties: {
			id,
			category,
			title,
			description,
			routes: [
				...new Set([
					...routeTokens(p.ptroutes),
					...routeTokens(p.ptroutesaffected),
				]),
			],
			start,
			end,
			timing,
			color,
			source: category === "shelters" ? SHELTER_SOURCE : source,
		},
	};
}
