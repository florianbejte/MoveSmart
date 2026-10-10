import { ConvexError, v } from "convex/values";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { place, sharedLeg, sharedSegment } from "./schema";

const token = (bytes: number) =>
	Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
const text = (s: string, max = 120) => s.trim().slice(0, max);

/** Start sharing a trip. Returns the public link id and the secret key for position updates. */
export const create = mutation({
	args: {
		from: place,
		to: place,
		label: v.string(),
		mode: v.string(),
		departAt: v.number(),
		arriveAt: v.number(),
		legs: v.array(sharedLeg),
		path: v.array(sharedSegment),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		if (args.legs.length > 4) throw new ConvexError("Too many legs");
		const points = args.path.reduce((n, s) => n + s.coordinates.length, 0);
		if (args.path.length > 12 || points > 4000)
			throw new ConvexError("Route is too detailed to share");
		const user = await authComponent.safeGetAuthUser(ctx);
		const shareId = token(12);
		const writeKey = token(24);
		await ctx.db.insert("sharedTrips", {
			...args,
			from: { ...args.from, name: text(args.from.name) },
			to: { ...args.to, name: text(args.to.name) },
			label: text(args.label),
			mode: text(args.mode, 20),
			name: user?.name ? text(user.name.split(" ")[0], 40) : undefined,
			shareId,
			writeKey,
			status: "active",
			createdAt: now,
			// Visible until two hours after arrival, and never longer than eight hours.
			expiresAt: Math.min(
				now + 8 * 3600_000,
				Math.max(args.arriveAt, now) + 2 * 3600_000,
			),
		});
		return { shareId, writeKey };
	},
});

async function owned(ctx: MutationCtx, shareId: string, writeKey: string) {
	const trip = await ctx.db
		.query("sharedTrips")
		.withIndex("by_share", (q) => q.eq("shareId", shareId))
		.unique();
	if (!trip || trip.writeKey !== writeKey)
		throw new ConvexError("Not your shared trip");
	return trip;
}

/** The sharer's latest position, sent every few seconds while sharing. */
export const updatePosition = mutation({
	args: {
		shareId: v.string(),
		writeKey: v.string(),
		lat: v.number(),
		lon: v.number(),
		accuracy: v.number(),
	},
	handler: async (ctx, { shareId, writeKey, lat, lon, accuracy }) => {
		const trip = await owned(ctx, shareId, writeKey);
		const now = Date.now();
		if (trip.status !== "active" || trip.expiresAt < now) return false;
		if (trip.position && now - trip.position.at < 4_000) return true;
		await ctx.db.patch(trip._id, {
			position: { lat, lon, accuracy: Math.min(accuracy, 5000), at: now },
		});
		return true;
	},
});

/** Stop sharing (or mark arrived); the page then shows the trip as ended. */
export const stop = mutation({
	args: {
		shareId: v.string(),
		writeKey: v.string(),
		arrived: v.optional(v.boolean()),
	},
	handler: async (ctx, { shareId, writeKey, arrived }) => {
		const trip = await owned(ctx, shareId, writeKey);
		await ctx.db.patch(trip._id, {
			status: arrived ? "arrived" : "stopped",
			position: arrived ? trip.position : undefined,
		});
	},
});

/** Public view of a shared trip; never includes the write key. */
export const get = query({
	args: { shareId: v.string() },
	handler: async (ctx, { shareId }) => {
		const trip = await ctx.db
			.query("sharedTrips")
			.withIndex("by_share", (q) => q.eq("shareId", shareId))
			.unique();
		if (!trip) return null;
		const { writeKey: _secret, _id, _creationTime, ...visible } = trip;
		return visible;
	},
});
