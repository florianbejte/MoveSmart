import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

const kind = v.union(
	v.literal("protest"),
	v.literal("event"),
	v.literal("blocked"),
	v.literal("emergency"),
);
// Reports fade after three hours unless other riders confirm them.
const TTL = 3 * 60 * 60 * 1000;

const metres = (
	a: { lat: number; lon: number },
	b: { lat: number; lon: number },
) => {
	const k = Math.cos((a.lat * Math.PI) / 180);
	return Math.hypot((a.lon - b.lon) * k, a.lat - b.lat) * 111_320;
};

/** Active reports; `now` comes from the client, rounded to the minute, so the query caches. */
export const active = query({
	args: { now: v.number() },
	handler: async (ctx, { now }) => {
		const rows = await ctx.db
			.query("areaReports")
			.withIndex("by_expiry", (q) => q.gt("expiresAt", now))
			.take(200);
		return rows.map((r) => ({
			id: r._id,
			kind: r.kind,
			lat: r.lat,
			lon: r.lon,
			note: r.note,
			reports: r.userIds.length,
			reportedAt: r.updatedAt,
			expiresAt: r.expiresAt,
		}));
	},
});

/** Report or confirm a place to avoid. A report within 300 m of the same kind is confirmed instead. */
export const report = mutation({
	args: {
		kind,
		lat: v.number(),
		lon: v.number(),
		note: v.optional(v.string()),
	},
	handler: async (ctx, { kind, lat, lon, note }) => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) throw new ConvexError("Sign in to report");
		if (lat < 54.4 || lat > 54.95 || lon < 24.9 || lon > 25.65)
			throw new ConvexError("Reports are for Vilnius only");
		const now = Date.now();
		const nearby = (
			await ctx.db
				.query("areaReports")
				.withIndex("by_expiry", (q) => q.gt("expiresAt", now))
				.take(200)
		).find((r) => r.kind === kind && metres(r, { lat, lon }) <= 300);
		if (nearby) {
			if (nearby.userIds.includes(user._id)) return nearby._id;
			await ctx.db.patch(nearby._id, {
				userIds: [...nearby.userIds, user._id].slice(-50),
				updatedAt: now,
				expiresAt: now + TTL,
			});
			return nearby._id;
		}
		return await ctx.db.insert("areaReports", {
			kind,
			lat,
			lon,
			note: note?.trim().slice(0, 120) || undefined,
			userIds: [user._id],
			createdAt: now,
			updatedAt: now,
			expiresAt: now + TTL,
		});
	},
});
