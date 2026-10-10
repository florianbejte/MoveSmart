import { lithuanian, templates } from "./lt";
export type Language = "lt" | "en";
export const LANGUAGE_KEY = "movesmart-language";
let language: Language = "lt";
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const getServerLanguage = (): Language => "lt";
export function subscribeLanguage(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
export function setLanguage(next: Language) {
	language = next;
	if (typeof document !== "undefined") document.documentElement.lang = next;
	try {
		localStorage.setItem(LANGUAGE_KEY, next);
	} catch {
		/* Private mode still supports switching for this visit. */
	}
	for (const listener of listeners) listener();
}
export function restoreLanguage() {
	try {
		setLanguage(localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "lt");
	} catch {
		setLanguage("lt");
	}
}
const escapePattern = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(templates).map(([source, target]) => ({
	regex: new RegExp(
		"^" +
			source
				.split(/\{\d+\}/)
				.map(escapePattern)
				.join("(.*?)") +
			"$",
	),
	target,
}));
/** Translate app-owned display text. Non-string React children and source values pass through. */
export function translate<T>(value: T, locale: Language, depth = 0): T {
	if (locale === "en" || typeof value !== "string" || !value.trim())
		return value;
	const key = value.trim();
	if (
		depth < 5 &&
		!lithuanian[key] &&
		(key.includes("\n") || key.includes(" · "))
	) {
		return value
			.split(/(\n| · )/)
			.map((part) =>
				part === "\n" || part === " · "
					? part
					: translate(part, locale, depth + 1),
			)
			.join("") as T;
	}
	const price = key.match(/^(from |~)?€(\d+(?:\.\d+)?)(?:–(\d+(?:\.\d+)?))?$/);
	if (price) {
		const number = (v: string) =>
			Number(v).toLocaleString("lt-LT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			});
		return `${price[1] === "from " ? "nuo " : price[1] || ""}${number(price[2])}${price[3] ? "–" + number(price[3]) : ""} €` as T;
	}
	if (/^\d+\.\d+ (km|kg)$/.test(key)) return value.replace(".", ",") as T;
	let result = lithuanian[key];
	if (!result && depth < 5) {
		for (const { regex, target } of patterns) {
			const match = key.match(regex);
			if (match) {
				result = target.replace(/\{(\d+)\}/g, (_, index) =>
					translate(match[Number(index) + 1], locale, depth + 1),
				);
				break;
			}
		}
	}
	return (result ? value.replace(key, () => result) : value) as T;
}
/** For imperative MapLibre content, called at the moment a popup is created. */
export const t = <T>(value: T): T => translate(value, getLanguage());
export const dateLocale = () => (getLanguage() === "lt" ? "lt-LT" : "en-GB");

/** OSM category codes are presentation metadata, not place names. Unknown codes use a translated generic label. */
export function placeKindLabel(kind: string): string {
	const labels: Record<string, string> = {
		address: "Address",
		residential: "Residential street",
		tertiary: "Street",
		secondary: "Street",
		primary: "Street",
		unclassified: "Street",
		pedestrian: "Pedestrian street",
		footway: "Footpath",
		path: "Path",
		cycleway: "Cycle path",
		bus_stop: "Stop",
		"bus stop": "Stop",
		tram_stop: "Stop",
		station: "Station",
		school: "School",
		university: "University",
		college: "College",
		hospital: "Hospital",
		clinic: "Clinic",
		pharmacy: "Pharmacy",
		restaurant: "Restaurant",
		cafe: "Café",
		supermarket: "Supermarket",
		mall: "Shopping centre",
		park: "Park",
		playground: "Playground",
		museum: "Museum",
		theatre: "Theatre",
		cinema: "Cinema",
		hotel: "Hotel",
		parking: "Parking",
		library: "Library",
		bank: "Bank",
		office: "Office",
		building: "Building",
		apartments: "Apartments",
		house: "House",
		suburb: "Neighbourhood",
		neighbourhood: "Neighbourhood",
		city: "City",
		town: "Town",
		village: "Village",
		airport: "Airport",
		aerodrome: "Airport",
		platform: "Stop",
		place_of_worship: "Place of worship",
		"place of worship": "Place of worship",
		sports_centre: "Sports centre",
		"sports centre": "Sports centre",
		stadium: "Stadium",
	};
	return labels[kind] ?? "Place";
}
