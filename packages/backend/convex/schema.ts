import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const travelProfile = v.object({
	needs: v.array(
		v.union(
			v.literal("stroller"),
			v.literal("wheelchair"),
			v.literal("older"),
			v.literal("kids"),
			v.literal("luggage"),
		),
	),
	hasCar: v.boolean(),
	hasBike: v.boolean(),
	sharedOk: v.boolean(),
	hasPass: v.boolean(),
	priorities: v.array(
		v.union(
			v.literal("speed"),
			v.literal("comfort"),
			v.literal("cost"),
			v.literal("eco"),
			v.literal("certainty"),
		),
	),
	walkLimit: v.number(),
	weatherSensitive: v.boolean(),
});

export default defineSchema({
	// One travel profile per account, filled in by the onboarding questionnaire.
	profiles: defineTable({
		userId: v.string(),
		profile: travelProfile,
		updatedAt: v.number(),
	}).index("by_user", ["userId"]),
	// Places a user has planned trips to, newest first, for one-tap "where to?".
	places: defineTable({
		userId: v.string(),
		name: v.string(),
		lat: v.number(),
		lon: v.number(),
		usedAt: v.number(),
		uses: v.number(),
	})
		.index("by_user", ["userId", "usedAt"])
		.index("by_user_name", ["userId", "name"]),
	// Rider reports of places to avoid that no official feed covers (protests, crowds).
	areaReports: defineTable({
		kind: v.union(
			v.literal("protest"),
			v.literal("event"),
			v.literal("blocked"),
			v.literal("emergency"),
		),
		lat: v.number(),
		lon: v.number(),
		note: v.optional(v.string()),
		userIds: v.array(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		expiresAt: v.number(),
	}).index("by_expiry", ["expiresAt"]),
	// Green trips a user set off on, for their personal CO₂ savings.
	greenTrips: defineTable({
		userId: v.string(),
		mode: v.string(),
		co2Saved: v.number(),
		at: v.number(),
	}).index("by_user", ["userId", "at"]),
});
