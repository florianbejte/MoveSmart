/** A rider's travel profile, collected by onboarding and kept in the browser only. */
export type Need = "stroller" | "wheelchair" | "older" | "kids" | "luggage";
export type Priority = "speed" | "comfort" | "cost" | "eco" | "certainty";
export type Profile = {
	needs: Need[];
	hasCar: boolean;
	hasBike: boolean;
	sharedOk: boolean;
	hasPass: boolean;
	priorities: Priority[];
	/** Longest walk the rider is happy with, in minutes. */
	walkLimit: number;
	weatherSensitive: boolean;
};

export const DEFAULT_PROFILE: Profile = {
	needs: [],
	hasCar: false,
	hasBike: false,
	sharedOk: true,
	hasPass: false,
	priorities: ["speed"],
	walkLimit: 15,
	weatherSensitive: false,
};

export const NEEDS: { id: Need; label: string; hint: string }[] = [
	{
		id: "stroller",
		label: "With a stroller",
		hint: "Step-free, fewer changes",
	},
	{
		id: "wheelchair",
		label: "Wheelchair or reduced mobility",
		hint: "Step-free only",
	},
	{ id: "older", label: "Older traveller", hint: "Shorter, slower walks" },
	{ id: "kids", label: "With children", hint: "Safer, simpler trips" },
	{ id: "luggage", label: "With luggage", hint: "Less walking, no bikes" },
];
export const PRIORITIES: { id: Priority; label: string; hint: string }[] = [
	{ id: "speed", label: "Fastest", hint: "Door to door" },
	{ id: "comfort", label: "Comfort", hint: "Less walking and waiting" },
	{ id: "cost", label: "Cheapest", hint: "Every euro counts" },
	{ id: "eco", label: "Greenest", hint: "Lowest CO₂" },
	{ id: "certainty", label: "Reliable", hint: "No surprises" },
];

export const stepFree = (p: Profile) =>
	p.needs.includes("wheelchair") || p.needs.includes("stroller");
/** Walking pace in metres per minute; slower with a stroller, wheelchair or for older travellers. */
export const walkPace = (p: Profile) =>
	p.needs.some((n) => n === "wheelchair" || n === "older" || n === "stroller")
		? 58
		: 75;

/** A friendly name for the profile, shown after onboarding. */
export function persona(p: Profile) {
	if (p.needs.includes("wheelchair")) return "Step-free traveller";
	if (p.needs.includes("stroller") || p.needs.includes("kids"))
		return p.priorities.includes("comfort")
			? "Comfort-first parent"
			: "Parent on the move";
	if (p.needs.includes("older")) return "Easy-going explorer";
	if (p.needs.includes("luggage")) return "Traveller with bags";
	const first = p.priorities[0];
	if (first === "eco") return p.hasBike ? "Green cyclist" : "Green commuter";
	if (first === "cost") return "Smart saver";
	if (first === "comfort") return "Comfort seeker";
	if (first === "certainty") return "Punctual planner";
	return p.hasCar ? "Fast driver, open to options" : "Fast city mover";
}

const KEY = "movesmart-profile";
export function loadProfile(): Profile | null {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : null;
	} catch {
		return null;
	}
}
export function saveProfile(p: Profile) {
	try {
		localStorage.setItem(KEY, JSON.stringify(p));
	} catch {
		// Private mode: the profile still applies for this visit.
	}
}
