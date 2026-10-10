/**
 * Taxi and car-sharing providers in Vilnius with published or reported tariffs.
 * Prices are estimates for comparison; each app shows the exact price before booking.
 *
 * Sources (checked October 2026):
 * - Bolt and Uber base tariffs: taxifarefinder.com (Vilnius) and aboutlist.org Vilnius taxi prices
 * - Metered taxi tariff: aboutlist.org Vilnius taxi prices
 * - Fleet size and waits: taxibambino.com Vilnius taxi guide (Bolt dominant, Uber fewer cars)
 * - SPARK: spark.lt; CityBee: madeinvilnius.lt price comparison (2023 rates, may have changed)
 */
export type ProviderKind = "taxi" | "carshare";
export type Provider = {
	id: string;
	name: string;
	kind: ProviderKind;
	/** Euros. Null when no published tariff exists; the app then says "see price in app". */
	tariff: {
		base: number;
		perKm: number;
		perMin: number;
		minimum: number;
	} | null;
	/** Price is fixed when you book (upfront), rather than metered. */
	upfront: boolean;
	/** Prices rise with demand (rush hour, events, bad weather). */
	surge: boolean;
	/** Typical pickup wait (taxi) or walk to the nearest car (car sharing), minutes. */
	reach: number;
	/** 1–3: how easy it is to get a car quickly in Vilnius. */
	availability: 1 | 2 | 3;
	electric?: boolean;
	note?: string;
	url: string;
	source: string;
};

export const PROVIDERS: Provider[] = [
	{
		id: "bolt",
		name: "Bolt",
		kind: "taxi",
		tariff: { base: 0.8, perKm: 0.33, perMin: 0.12, minimum: 1.5 },
		upfront: true,
		surge: true,
		reach: 4,
		availability: 3,
		note: "Most cars in Vilnius",
		url: "https://bolt.eu/en-lt/",
		source: "taxifarefinder.com",
	},
	{
		id: "uber",
		name: "Uber",
		kind: "taxi",
		tariff: { base: 0.9, perKm: 0.4, perMin: 0.1, minimum: 2 },
		upfront: true,
		surge: true,
		reach: 7,
		availability: 2,
		note: "Fewer cars, longer waits",
		url: "https://m.uber.com/",
		source: "aboutlist.org",
	},
	{
		id: "metered",
		name: "Street or phone taxi (eTaksi and others)",
		kind: "taxi",
		tariff: { base: 1, perKm: 0.8, perMin: 0, minimum: 3 },
		upfront: false,
		surge: false,
		reach: 9,
		availability: 1,
		note: "Metered fare, no surge",
		url: "",
		source: "aboutlist.org",
	},
	{
		id: "spark",
		name: "SPARK",
		kind: "carshare",
		tariff: { base: 0, perKm: 0.37, perMin: 0.17, minimum: 0 },
		upfront: false,
		surge: false,
		reach: 6,
		availability: 2,
		electric: true,
		note: "Electric cars",
		url: "https://spark.lt/en/",
		source: "spark.lt",
	},
	{
		id: "citybee",
		name: "CityBee",
		kind: "carshare",
		tariff: { base: 0, perKm: 0.22, perMin: 0.13, minimum: 0 },
		upfront: false,
		surge: false,
		reach: 5,
		availability: 3,
		note: "Largest fleet; tariff from 2023",
		url: "https://citybee.lt/en/",
		source: "madeinvilnius.lt (2023)",
	},
	{
		id: "bolt-drive",
		name: "Bolt Drive",
		kind: "carshare",
		tariff: null,
		upfront: false,
		surge: false,
		reach: 6,
		availability: 2,
		note: "Price shown in the Bolt app",
		url: "https://bolt.eu/en-lt/drive/",
		source: "lrt.lt",
	},
];

export type Quote = Provider & {
	/** Estimated euros, or null when the provider publishes no tariff. */
	price: number | null;
	/** Price range when surge pricing is likely. */
	priceHigh: number | null;
	badges: string[];
	score: number;
};

/** Quotes for one trip, best first for the rider's priorities. */
export function quote(
	kind: ProviderKind,
	trip: { km: number; minutes: number; rush: boolean },
	priorities: string[],
): Quote[] {
	const quotes = PROVIDERS.filter((p) => p.kind === kind).map((p): Quote => {
		const t = p.tariff;
		const raw = t
			? Math.max(
					t.minimum,
					t.base + t.perKm * trip.km + t.perMin * trip.minutes,
				)
			: null;
		const price = raw === null ? null : Math.round(raw * 10) / 10;
		const priceHigh =
			price !== null && p.surge && trip.rush
				? Math.round(price * 1.5 * 10) / 10
				: null;
		// Lower is better: expected price plus time to get going, plus uncertainty.
		const expected = priceHigh ?? price ?? 99;
		const certainty = (p.upfront ? 0 : 1.5) + (3 - p.availability) * 1.5;
		const score =
			expected * (priorities.includes("cost") ? 2 : 1) +
			p.reach * 0.3 +
			certainty * (priorities.includes("certainty") ? 2 : 1) +
			(p.electric && priorities.includes("eco") ? -2 : 0);
		return { ...p, price, priceHigh, badges: [], score };
	});
	const priced = quotes.filter((q) => q.price !== null);
	const cheapest = Math.min(...priced.map((q) => q.priceHigh ?? q.price ?? 99));
	const reliability = (q: Quote) =>
		q.availability * 2 + (q.upfront ? 2 : 0) + (q.surge && trip.rush ? -1 : 0);
	const mostReliable = Math.max(...quotes.map(reliability));
	const fastest = Math.min(...quotes.map((q) => q.reach));
	for (const q of quotes) {
		if (q.price !== null && (q.priceHigh ?? q.price) === cheapest)
			q.badges.push("Cheapest");
		if (reliability(q) === mostReliable) q.badges.push("Most reliable");
		if (q.reach === fastest)
			q.badges.push(kind === "taxi" ? "Shortest wait" : "Closest car");
		if (q.upfront) q.badges.push("Fixed price when you book");
		if (q.surge && trip.rush) q.badges.push("Surge pricing likely now");
		if (q.electric) q.badges.push("Electric");
	}
	return quotes.sort((a, b) => a.score - b.score);
}

/** Deep link that opens the provider with the trip filled in, where the provider supports it. */
export function bookingLink(
	provider: Provider,
	from: { lat: number; lon: number },
	to: { lat: number; lon: number; name: string },
) {
	if (provider.id === "uber") {
		const params = new URLSearchParams({
			action: "setPickup",
			"pickup[latitude]": String(from.lat),
			"pickup[longitude]": String(from.lon),
			"dropoff[latitude]": String(to.lat),
			"dropoff[longitude]": String(to.lon),
			"dropoff[nickname]": to.name,
		});
		return `https://m.uber.com/ul/?${params}`;
	}
	return provider.url;
}
