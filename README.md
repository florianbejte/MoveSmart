# MoveSmart

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Convex, and more.

## Live Vilnius transit

The home page uses MapLibre with OpenStreetMap tiles, live JUDU vehicle positions,
and GTFS schedules. No account or transit API key is needed.

- Live bus and trolleybus markers refresh every 15 seconds while the page is visible.
- Search stops, routes and destinations; filter by mode, route or a 2 km radius.
- “Use my location” asks for browser permission and sorts nearby stops and vehicles.
  Without permission, distances use the map center. Location stays in the browser;
  ordinary map tile requests reveal the viewed map area to the tile provider.
- Select a stop/platform for departures, or a vehicle for its trip and route shape.
- Estimates apply the vehicle's reported schedule deviation to its GTFS departure
  time. They are not official stop-level predictions. Unmatched or stale vehicles
  fall back to scheduled departures; positions older than two minutes are faded.
- Service calendars, date exceptions, Vilnius time and trips continuing after midnight
  are handled server-side.

### Run and verify

```bash
bun install
bun run dev:web
# Open http://localhost:3001
bun run --cwd apps/web test
bun run check-types
bun run --cwd apps/web build
```

### Data and hosting

`/api/transit?kind=network` returns stops and routes; `kind=vehicles` returns live
positions. `kind=stop&id=...` returns departures and `kind=trip&id=...` returns a
trip's shape and stops. All upstream URLs are fixed; the API cannot proxy arbitrary URLs.

Sources: [JUDU open data](https://judu.lt/kita-informacija/atviri-duomenys/),
[GTFS](https://www.stops.lt/vilnius/vilnius/gtfs.zip), and
[GPS](https://stops.lt/vilnius/gps_full.txt). Observe the provider's published usage terms.

GTFS is cached for six hours, GPS for ten seconds, with concurrent requests shared
within each server process. Errors retain the last usable snapshot, explicitly marked
stale. The cache is in memory: cold starts fetch fresh data; multi-instance deployments
should use a shared cache to avoid multiplying upstream traffic. A Node.js server is
required; static-only export does not support these API routes.

The default raster tiles use `tile.openstreetmap.org`, preserving browser caching,
Referer headers and visible attribution. No tile scraping, bulk download or offline
prefetch is implemented. For higher-volume hosting, configure an OSM-based tile
provider appropriate to your traffic and its terms:

```dotenv
NEXT_PUBLIC_MAP_TILE_URL=https://your-provider.example/{z}/{x}/{y}.png
NEXT_PUBLIC_MAP_ATTRIBUTION=Your provider attribution plus OpenStreetMap contributors
```

The URL is a 256px raster tile template. Set these in `apps/web/.env` or your hosting
environment and rebuild. Include the attribution links required by your provider.
See [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

Development and production builds automatically copy MapLibre's ESM worker and
shared module to `public/maplibre/`. Fonts are bundled locally, so builds don't
need to contact Google Fonts.

## Stack

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Convex** - Reactive backend-as-a-service platform
- **Authentication** - Better-Auth
- **Biome** - Linting and formatting
- **Husky** - Git hooks for code quality
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Convex Setup

The public transit map runs without Convex. Start it with `bun run dev:web`.

Accounts use Convex and Better Auth. To enable accounts:

```bash
bun run dev:setup
```

Follow the prompts to create a new Convex project and connect it to your application.

Copy environment variables from `packages/backend/.env.local` to `apps/*/.env`.

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Your app will connect to the Convex cloud backend automatically.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@MoveSmart/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Git Hooks and Formatting

- Initialize hooks: `bun run prepare`
- Run checks: `bun run check`

## Project Structure

```
MoveSmart/
├── apps/
│   ├── web/         # Frontend application (Next.js)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── backend/     # Convex backend functions and schema
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:setup`: Setup and configure your Convex project
- `bun run check-types`: Check TypeScript types across all apps
- `bun run check`: Run Biome formatting and linting

### City data layers

Open **City layers** in the sidebar to toggle transit disruptions, roadworks,
restrictions, congestion/road load, parking zones, traffic-light locations, and
coordinated green corridors. Hover over map geometry for a preview; click or tap to pin a popup with the published description,
route numbers, period (Vilnius time), and source link. Transit notices follow the
selected vehicle, stop, or route filter. Route numbers in the incident source do
not always distinguish bus and trolleybus services.

`/api/city?layer=incidents|roadworks|restrictions|congestion|parking|signals|corridors`
proxies an allowlist of city ArcGIS layers. Optional layers fetch only when enabled;
transit alerts always refresh. Event/load caches refresh every minute; infrastructure
caches every six hours. Concurrent requests share upstream work. Object-ID batches
avoid the ArcGIS 1,000-record transfer limit. Failures retain saved geometry with a
visible stale/partial warning, and public fields are explicitly whitelisted.

Sources:
- [City dynamic service](https://arcgis.sviesoforai.lt/arcgis/rest/services/VIS/Vilnius_sde_dynamic/MapServer): layers 6–7, 9–10, 12–14, 22–24, 26.
- [Signal and corridor map](https://portal.sisp.lt/portal/apps/webappviewer/index.html?id=77456a13ed0041a9857cb3f810204111): its published `Sankryžos_ir_koridoriai_(view_only)` FeatureServer layers 1–2.

Hidden, expired, and not-yet-published events are excluded. Planned and recurring
records are labeled; recurring schedules are not interpreted as continuously active.
A fetched timestamp is **not** a source measurement timestamp. Road-load units and
measurement times are absent, so values are shown without inferred percentages or
live severity labels. Parking gives boundaries, not prices or availability; signals
and corridors describe infrastructure, not current red/green phases. Undocumented
GPS vehicle-type and interval codes remain unused. These integrations do not include
third-party Waze data or establish additional rights beyond the providers' terms.

### Mobile-first interface

The transit sheet has three positions: tap **Map** for the full map, **Nearby** or
**Layers** for a half sheet, and the handle/chevron to expand it. The handle also
supports swiping. Stop and vehicle selection opens a taller detail sheet; search
opens the expanded view. Tapping a city feature pins its popup and reveals the map.
Route and transport filters live behind the sliders button next to search. All
existing data sources and map overlays remain available.

The interface uses locally hosted Manrope, matching blue/yellow route signs across
the map and departure lists, and action-driven sheet, view, and switch transitions.
It respects reduced-motion preferences. See [DESIGN.md](DESIGN.md) for the design
plan and visual tokens.

### Shelters and service colours

Enable **City layers → Civil-protection shelters** to show Lithuania’s published
shelter network. Hover or tap a point for its address, published capacity,
disability adaptation, entry hours, and record update date. Missing access values
remain unknown; capacity is not live occupancy. Data: PAGD / Valstybės duomenų
agentūra, [CC BY 4.0 dataset](https://open.geodata.gov.lt/datasets/8a1e4b06ca714e2983b67c737c667abe_0/).
The server caches the national layer for six hours and retrieves bounded ID
batches to avoid ArcGIS transfer and URL-length limits.

Transit markers, badges and selected route lines use GTFS `route_color`.
Missing colours fall back to green express, blue regular bus, red trolleybus,
black night bus, or teal L1. L1 colour support does not imply a live river feed.
