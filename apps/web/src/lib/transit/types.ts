export type Position = { lat: number; lon: number };
export type TransitRoute = {
	id: string;
	name: string;
	title: string;
	mode: "bus" | "trolleybus" | "other";
	color: string;
};
export type Stop = Position & {
	id: string;
	name: string;
	description: string;
	routeIds: string[];
};
export type Vehicle = Position & {
	id: string;
	number: string;
	routeId: string | null;
	route: string;
	mode: "bus" | "trolleybus";
	destination: string;
	tripId: string | null;
	speed: number;
	heading: number;
	delay: number | null;
	measuredAt: number;
};
export type Network = {
	stops: Stop[];
	routes: TransitRoute[];
	updatedAt: number;
	stale: boolean;
};
export type LiveFeed = {
	vehicles: Vehicle[];
	fetchedAt: number;
	sourceUpdatedAt: number;
	stale: boolean;
};
export type Departure = {
	tripId: string;
	routeId: string;
	destination: string;
	scheduledAt: number;
	estimatedAt: number;
	vehicleId: string | null;
	live: boolean;
};
export type StopBoard = {
	stop: Stop;
	departures: Departure[];
	stale: boolean;
	generatedAt: number;
};
export type TripDetail = {
	id: string;
	routeId: string;
	destination: string;
	coordinates: [number, number][];
	stops: Stop[];
};
