# MoveSmart — a pocket map for Vilnius

The job: see nearby public transport, choose a stop, and understand the next departure while on the move.

## Design tokens
- Paper `#ffffff`: sheets and timetable surfaces.
- Transit blue `#204bcc`: brand, buses, active controls, selected routes.
- Ink `#182744`: primary copy and route names.
- Bus yellow `#f3ce49`: trolleybus badges and the location action.
- Mist `#edf1f7`: recessed controls and map chrome.
- Slate `#627089`: secondary copy.

Manrope Variable is the single locally hosted family. Generous geometric headings (28/34), clear stop names (15/21), body (13/20), and readable metadata (11/16). Numbers use tabular figures. All content is left aligned except compact route signs and navigation actions.

## Layout options and review
A permanently stacked phone sidebar obscures the map and puts primary actions out of reach. A floating card grid repeats the generic dashboard treatment. Choose one adjustable transit sheet, flat timetable rows, and a three-action mobile dock instead.

Phone                      Desktop
+--------------------+     +--------------------------------------+
| MoveSmart  Vilnius  |     | MoveSmart       Live map     Account |
|                    |     | +----------------+                   |
|   interactive map  |     | | Find your ride |   interactive map |
|            locate  |     | | Search        |                   |
|____________________|     | | Nearby/Layers |                   |
|    sheet handle    |     | | Timetable     |                   |
| Nearby / City data |     | | rows          |                   |
| stop + route rows  |     | +----------------+        key        |
| Map  Nearby Layers |     +--------------------------------------+
+--------------------+

The single memorable device is the route sign: blue for buses, yellow for trolleybuses. These colors repeat in the map, legends, and timetable, giving the interface a transit-specific vocabulary rather than decorative accents.

## Motion and interaction
The sheet has map-only, half, and expanded states, accessible by buttons and a swipe handle. A single initial sheet reveal establishes depth; subsequent motion follows actions. Views crossfade, selected rows respond, and switches slide. Never animate the positioning transform MapLibre owns. Reduced-motion mode disables decorative movement and map fly animations.

Keep city geometry popups on the map. Keep source freshness, errors, time estimates, attribution, and all filters available. Use real data throughout. Review phone, narrow phone, short landscape, and desktop screenshots, keyboard access, and overflow before completion.
