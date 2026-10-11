import type { TransitRide } from "./transit";

export type CompanionLeg = TransitRide & {
	fromStop: string;
	toStop: string;
	route: string;
};
export type CompanionStep = {
	/** Stable per moment of the trip, so each notification fires once. */
	key: string;
	tone: "info" | "go" | "alert" | "done";
	title: string;
	detail: string;
	/** Worth a phone notification, not just an on-screen update. */
	notify: boolean;
};

const time = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Vilnius",
	hour: "2-digit",
	minute: "2-digit",
});
const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));

/**
 * What the rider should do right now on a public transport trip. Live delays reported after
 * planning shift the bus times; walking minutes come from the plan.
 */
export function companionStep(
	legs: CompanionLeg[],
	now: number,
	/** Current live delay (seconds) per trip, when the bus reports one. */
	liveDelay: (tripId: string) => number | null,
	walkToFirstStopMinutes: number,
	/** Park & Ride: drive to this lot first (its minutes are part of walkToFirstStopMinutes). */
	drive?: { lot: string; minutes: number },
): CompanionStep {
	const shifted = legs.map((leg) => {
		const delay = liveDelay(leg.tripId);
		const shift = delay === null ? 0 : (delay - (leg.delaySeconds ?? 0)) * 1000;
		return {
			...leg,
			departAt: leg.departAt + shift,
			arriveAt: leg.arriveAt + shift,
			live: delay !== null || leg.live,
		};
	});
	const first = shifted[0];
	const leaveAt = first.departAt - (walkToFirstStopMinutes + 1) * 60_000;
	if (now < leaveAt - 60_000)
		return {
			key: "wait",
			tone: "info",
			// Far-off trips read better as a clock time than as hundreds of minutes.
			title:
				leaveAt - now > 60 * 60_000
					? `Leave at ${time.format(leaveAt)}`
					: `Leave in ${mins(leaveAt - now)} min`,
			detail: `Allow ${walkToFirstStopMinutes} min to get to ${first.fromStop}. Bus ${first.route} leaves at ${time.format(first.departAt)}${first.live ? " (live)" : ""}.`,
			notify: false,
		};
	if (drive && now < leaveAt + drive.minutes * 60_000)
		return {
			key: "drive",
			tone: "go",
			title: `Drive to the Park & Ride at ${drive.lot}`,
			detail: `Park there, then bus ${first.route} leaves ${first.fromStop} at ${time.format(first.departAt)}.`,
			notify: true,
		};
	if (now < first.departAt - 2 * 60_000)
		return {
			key: "walk",
			tone: "go",
			title: `Start walking to ${first.fromStop}`,
			detail: `Bus ${first.route} leaves at ${time.format(first.departAt)} — in ${mins(first.departAt - now)} min.`,
			notify: true,
		};
	for (let i = 0; i < shifted.length; i++) {
		const leg = shifted[i];
		if (now < leg.departAt)
			return {
				key: `board-${i}`,
				tone: "alert",
				title: `Bus ${leg.route} arrives in ${Math.max(1, mins(leg.departAt - now))} min`,
				detail: `Board at ${leg.fromStop} towards your destination. ${leg.stops} stop${leg.stops === 1 ? "" : "s"} to ${leg.toStop}.`,
				notify: true,
			};
		if (now < leg.arriveAt - 2 * 60_000)
			return {
				key: `ride-${i}`,
				tone: "info",
				title: `On bus ${leg.route} — get off at ${leg.toStop}`,
				detail: `Arriving ${time.format(leg.arriveAt)}, in ${mins(leg.arriveAt - now)} min.`,
				notify: false,
			};
		if (now < leg.arriveAt + 60_000)
			return {
				key: `exit-${i}`,
				tone: "alert",
				title: `Your stop is next: ${leg.toStop}`,
				detail:
					i < shifted.length - 1
						? `Get ready to get off and change to bus ${shifted[i + 1].route}.`
						: "Get ready to get off.",
				notify: true,
			};
		const next = shifted[i + 1];
		if (next && now < next.departAt)
			return {
				key: `change-${i}`,
				tone: "go",
				title: `Change to bus ${next.route}`,
				detail: `${next.fromStop === leg.toStop ? "Same stop" : `Walk to ${next.fromStop}`} — leaves at ${time.format(next.departAt)}, in ${Math.max(1, mins(next.departAt - now))} min.`,
				notify: true,
			};
	}
	return {
		key: "done",
		tone: "done",
		title: "You’ve arrived",
		detail: "Walk the last bit to your destination. Have a good one!",
		notify: true,
	};
}
