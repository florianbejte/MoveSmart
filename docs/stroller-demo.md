# Stroller route demo

In Plan, enable **Try stroller demo** (Lithuanian: **Išbandyti kelionę su vežimėliu**), then select a destination. Turn it off to restore the saved profile and normal ranking.

The toggle adds the stroller need for this visit without saving it to the account. This applies slower walking, stronger walking/transfer/crowding preferences, and excludes bikes and scooters. Each transit route gets a stable simulated boarding scenario from `src/lib/plan/demo.ts`: 25% occupied with stroller space; 85% occupied without stroller space; or 50% occupied with boarding steps. For multiple buses, the least suitable leg determines the displayed demo conditions.

Demo crowding affects the ranking formula. Missing stroller space adds a 25-point comfort penalty; boarding steps exclude an itinerary for step-free profiles. Route cards and the formula explain the simulation. Route paths, schedules, live positions and public reports remain real and unchanged. This is not street-level step-free navigation or verified vehicle accessibility.
