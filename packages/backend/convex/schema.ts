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

export const place = v.object({
	name: v.string(),
	lat: v.number(),
	lon: v.number(),
});
export const sharedLeg = v.object({
	tripId: v.string(),
	routeId: v.string(),
	route: v.string(),
	fromStop: v.string(),
	toStop: v.string(),
	departAt: v.number(),
	arriveAt: v.number(),
	delaySeconds: v.union(v.number(), v.null()),
});
export const sharedSegment = v.object({
	kind: v.union(v.literal("walk"), v.literal("ride")),
	color: v.string(),
	coordinates: v.array(v.array(v.number())),
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
	// Live trip sharing: anyone with the link sees the route, the buses and the sharer's position.
	sharedTrips: defineTable({
		shareId: v.string(),
		// Only the sharer's device knows this; it's never returned by queries.
		writeKey: v.string(),
		name: v.optional(v.string()),
		from: place,
		to: place,
		label: v.string(),
		mode: v.string(),
		departAt: v.number(),
		arriveAt: v.number(),
		legs: v.array(sharedLeg),
		path: v.array(sharedSegment),
		position: v.optional(
			v.object({
				lat: v.number(),
				lon: v.number(),
				accuracy: v.number(),
				at: v.number(),
			}),
		),
		status: v.union(
			v.literal("active"),
			v.literal("stopped"),
			v.literal("arrived"),
		),
		createdAt: v.number(),
		expiresAt: v.number(),
	}).index("by_share", ["shareId"]),
	// Green trips a user set off on, for their personal CO₂ savings.
	greenTrips: defineTable({
		userId: v.string(),
		mode: v.string(),
		co2Saved: v.number(),
		at: v.number(),
	}).index("by_user", ["userId", "at"]),
});
