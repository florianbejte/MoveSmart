import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// MapLibre v6 ships an ESM worker with a shared module. Serve both from the
// same origin so Turbopack doesn't rewrite the worker's relative imports.
const dist = dirname(fileURLToPath(import.meta.resolve("maplibre-gl")));
const target = new URL("../public/maplibre/", import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
	await copyFile(join(dist, file), new URL(file, target));
}
