import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { travelProfile } from "./schema";

async function userId(
	ctx: Parameters<typeof authComponent.safeGetAuthUser>[0],
) {
	const user = await authComponent.safeGetAuthUser(ctx);
	return user?._id ?? null;
}

/** The signed-in user's travel profile; null when they haven't done onboarding yet. */
export const profile = query({
	args: {},
	handler: async (ctx) => {
		const id = await userId(ctx);
		if (!id) return null;
		const row = await ctx.db
			.query("profiles")
			.withIndex("by_user", (q) => q.eq("userId", id))
			.unique();
		return row?.profile ?? null;
	},
});

export const saveProfile = mutation({
	args: { profile: travelProfile },
	handler: async (ctx, { profile }) => {
		const id = await userId(ctx);
		if (!id) throw new ConvexError("Sign in to save your travel profile");
		if (
			profile.walkLimit < 1 ||
			profile.walkLimit > 60 ||
			!profile.priorities.length
		)
			throw new ConvexError("Invalid travel profile");
		const row = await ctx.db
			.query("profiles")
			.withIndex("by_user", (q) => q.eq("userId", id))
			.unique();
		if (row) await ctx.db.patch(row._id, { profile, updatedAt: Date.now() });
		else
			await ctx.db.insert("profiles", {
				userId: id,
				profile,
				updatedAt: Date.now(),
			});
	},
});

export const recentPlaces = query({
	args: {},
	handler: async (ctx) => {
		const id = await userId(ctx);
		if (!id) return [];
		const rows = await ctx.db
			.query("places")
			.withIndex("by_user", (q) => q.eq("userId", id))
			.order("desc")
			.take(6);
		return rows.map(({ name, lat, lon, uses }) => ({ name, lat, lon, uses }));
	},
});

export const rememberPlace = mutation({
	args: { name: v.string(), lat: v.number(), lon: v.number() },
	handler: async (ctx, place) => {
		const id = await userId(ctx);
		if (!id) return;
		const name = place.name.trim().slice(0, 80);
		if (!name) return;
		const existing = await ctx.db
			.query("places")
			.withIndex("by_user_name", (q) => q.eq("userId", id).eq("name", name))
			.unique();
		if (existing)
			await ctx.db.patch(existing._id, {
				lat: place.lat,
				lon: place.lon,
				usedAt: Date.now(),
				uses: existing.uses + 1,
			});
		else
			await ctx.db.insert("places", {
				userId: id,
				name,
				lat: place.lat,
				lon: place.lon,
				usedAt: Date.now(),
				uses: 1,
			});
	},
});
