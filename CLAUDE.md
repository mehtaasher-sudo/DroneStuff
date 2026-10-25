# CLAUDE.md - AeroCommand sUAS Airspace, Mission Planning & Telemetry Platform

## 1. Project Overview
AeroCommand is a full-stack web-based Ground Control & Airspace Intelligence platform for sUAS (drone) operators. It integrates FAA UAS Facility Maps (LAANC ceilings), Aloft/FAA airspace boundaries, live ADS-B traffic tracking with proximity alerts, an AI-driven waypoint mission planner, live flight telemetry tracking, and gate-locked pre-flight checklists.

## 2. Tech Stack
- **Framework:** Next.js 15 (App Router, TypeScript)
- **Styling:** Tailwind CSS + Lucide Icons (Dark Aviation HUD theme: slate-950 backgrounds, high-contrast cyan/emerald/amber/red telemetry accents)
- **Map Engine:** `maplibre-gl` via `react-map-gl` + `@turf/turf` for geospatial math
- **State Management:** Zustand (`useMissionStore`, `useAirspaceStore`, `useTelemetryStore`, `useChecklistStore`) in `src/stores/index.ts`
- **Database:** Prisma 7 + SQLite (`@prisma/adapter-better-sqlite3`) for saving missions, checklists, and flight logs
- **AI:** Anthropic TypeScript SDK, manual tool-use loop in `src/lib/agent.ts`

## 3. Core Data Sources & Free Zero-Key Fallbacks
Always ensure the app works out-of-the-box using free public aviation APIs, while supporting `.env` keys for Aloft, Flyzone LAANC, and ADS-B Exchange:
1. **FAA UASFM (LAANC Ceilings):**
   - Endpoint: `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data/FeatureServer/0/query`
   - Query by map bounding box (`outSR=4326`, `f=geojson`) to render grid ceilings (`CEILING` property in feet AGL).
2. **Airspace & TFRs:**
   - FAA Class Airspace ArcGIS FeatureServer (`Class_Airspace`) + Aloft Tile Server adapter (`ALOFT_API_KEY`).
3. **Live ADS-B Traffic:**
   - Default (Zero-Key): `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}`
   - Optional Key: ADS-B Exchange RapidAPI (`ADSBX_API_KEY`).
4. **Aviation Weather & Solar:**
   - METAR/TAF: `https://aviationweather.gov/api/data/metar?ids={icao}&format=json`
   - Winds Aloft (10m, 80m, 120m): Open-Meteo API (`https://api.open-meteo.com/v1/forecast`)
   - Kp index: NOAA SWPC `noaa-planetary-k-index.json`
   - Terrain: Open-Meteo elevation API (Copernicus 90 m DEM)

## 4. Coding & Safety Rules
- All altitudes must clearly distinguish between **AGL (Above Ground Level)** and **MSL (Mean Sea Level)**.
- Every generated or manually placed waypoint MUST be validated via `@turf/boolean-point-in-polygon` against the underlying FAA UASFM grid cell. If `waypoint.alt_agl > cell.CEILING`, flag the waypoint in red and display a LAANC violation warning. (`validateWaypoints` in `src/lib/laanc.ts`.)
- Keep UI panels modular inside `src/components/hud/`.
- Keep domain logic pure and unit-tested in `src/lib/` (tests in `tests/`); API routes in `src/app/api/` only fetch, validate (zod) and delegate.
- Never fabricate third-party endpoints. Providers without public docs (Aloft, Flyzone) plug in through `src/lib/laanc-provider.ts`.

## 5. Commands
- `npm run dev` — dev server (copies the MapLibre worker to `public/maplibre/` first)
- `npm test` — vitest unit tests
- `npm run lint` / `npx tsc --noEmit`
- `npm run db:push` — sync Prisma schema to SQLite
