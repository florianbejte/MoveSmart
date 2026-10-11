import type { TripOption } from "./options";

export type DemoAccess = {
	occupancy: number;
	stepFree: boolean;
	strollerSpace: boolean;
};
/** Stable presentation fixtures. Never written to reports, live vehicles or the timetable. */
export function demoAccess(route: string): DemoAccess {
	const seed = [...route].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3;
	return [
		{ occupancy: 25, stepFree: true, strollerSpace: true },
		{ occupancy: 85, stepFree: true, strollerSpace: false },
		{ occupancy: 50, stepFree: false, strollerSpace: true },
	][seed];
}
export function withDemoAccess(
	options: TripOption[],
	routeName: (id: string) => string,
): TripOption[] {
	return options.map((option) => {
		if (option.mode !== "transit" || !option.legs?.length) return option;
		const fixtures = option.legs.map((leg) =>
			demoAccess(routeName(leg.routeId)),
		);
		return {
			...option,
			demoAccess: {
				occupancy: Math.max(...fixtures.map((f) => f.occupancy)),
				stepFree: fixtures.every((f) => f.stepFree),
				strollerSpace: fixtures.every((f) => f.strollerSpace),
			},
		};
	});
}
