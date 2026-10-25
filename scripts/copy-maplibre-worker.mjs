// MapLibre resolves its web worker relative to its own module URL, which breaks once Next.js
// bundles it into a chunk. Serve the worker from /public instead (see setWorkerUrl in MapView).
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre/maplibre-gl-worker.mjs");
