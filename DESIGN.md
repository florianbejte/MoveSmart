# MoveSmart — a pocket map for Vilnius

The job: see nearby public transport, choose a stop, and understand the next departure while on the move.

## Design tokens
Follows the Go Vilnius × Vilnius brandbook (2025).
- Paper `#ffffff`: sheets and timetable surfaces.
- Iconic Red `#ed1c24`: brand, active controls, selected stops and the user's location.
- Navy `#414454` ("Worthy Vilnius"): primary copy and route names.
- Lime `#bdd947` ("Green Vilnius"): the locate action.
- Mist `#ebebeb` and Lavender `#ced2df`: recessed controls, borders and map chrome.
- Grey `#6b6b6b`: secondary copy.

Montserrat Variable (the brand's digital font) is the single locally hosted family. Generous geometric headings (28/34), clear stop names (15/21), body (13/20), and readable metadata (11/16). Numbers use tabular figures. All content is left aligned except compact route signs and navigation actions.

Shapes use the brand's speech bubble: rounded corners with a sharp bottom-right. The header wordmark boxes the first word like the brand's "GO", and the Gediminas Tower crenellation marks the city. The official Vilnius logo itself is not used.

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

The route sign keeps the official JUDU service colors (blue buses, red trolleybuses, green express, black night), which repeat in the map, legends and timetable; brand red is reserved for interface actions.

## Motion and interaction
The sheet has map-only, half, and expanded states, accessible by buttons and a swipe handle. A single initial sheet reveal establishes depth; subsequent motion follows actions. Views crossfade, selected rows respond, and switches slide. Never animate the positioning transform MapLibre owns. Reduced-motion mode disables decorative movement and map fly animations.

Keep city geometry popups on the map. Keep source freshness, errors, time estimates, attribution, and all filters available. Use real data throughout. Review phone, narrow phone, short landscape, and desktop screenshots, keyboard access, and overflow before completion.
