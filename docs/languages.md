# App languages

Lithuanian (`lt`) is the default, including server-rendered HTML. The LT/EN menu in the header changes the interface without resetting the selected view. The choice is stored under `movesmart-language` in this browser and synchronized across tabs. If browser storage is unavailable, switching still works for the current visit.

## Translation boundaries

- App interface, labels, descriptions, reports, errors, onboarding, account forms, map controls and popups use the shared catalogue in `apps/web/src/lib/i18n/lt.ts`.
- English is the source copy; `useT()` translates display strings inside React. Imperative MapLibre content uses `t()` at creation time.
- Route IDs/numbers, official stop names, destination names, addresses, operator names, and externally supplied notices retain their published form. OSM category codes get readable bilingual labels, with a generic Place fallback for unknown categories.
- UI dates use the chosen locale and the Europe/Vilnius time zone. Protocol timestamps and GTFS parsing are not localized. Lithuanian display prices and decimal distances use decimal commas.
- Language changes update the document language for assistive technology. Popups close on switching so stale-language popup content does not remain open.

## Adding copy

Add an English key and Lithuanian value in `lt.ts`, and render it through `useT()`. For a composed message, add a template with numbered placeholders. Translate app-owned labels before joining them; do not translate class names, routes, IDs, API payloads, or user-entered values. A source-data field should remain unchanged unless it contains an app-generated fallback.

Run `bun run --cwd apps/web test` and `bun run --cwd apps/web check-types`. Translation tests cover choice catalogues, template parameters, dynamic route labels, multiline shelter details, numeric formatting, English preservation, and missing literal display translations.
