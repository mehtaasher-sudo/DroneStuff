# AeroCommand

Web ground-control and airspace-intelligence platform for sUAS (drone) operators: FAA UAS Facility Map
LAANC ceilings, LAANC pre-checks, live ADS-B conflict alerting, an AI waypoint-planning copilot (Claude),
Litchi / QGroundControl / DJI WPML export, aviation weather, telemetry replay, and gate-locked checklists.

## Quick start

```bash
npm install          # also copies the MapLibre worker and generates the Prisma client
cp .env.example .env # add ANTHROPIC_API_KEY to enable the copilot
npm run db:push      # creates the SQLite database
npm run dev          # http://localhost:3000
```

Everything except the AI copilot works with zero API keys.

## Features

| Module | What it does | Code |
|---|---|---|
| Airspace & UASFM | Viewport-driven FAA UASFM grid (color-coded 0–400 ft AGL ceilings) and Class B/C/D/E airspace layers | `src/app/api/airspace/*`, `MapView.tsx` |
| LAANC pre-check | Intersects the operating polygon with UASFM cells: target ≤ min ceiling → *Instant Auto-Approval*; above → *Further Coordination* (Part 107) / not available (44809). Daylight/night via SunCalc. | `src/lib/laanc.ts` |
| LAANC submission | Pluggable provider interface; ships with a local simulator (`SIM-` references are **not** FAA authorizations) | `src/lib/laanc-provider.ts` |
| ADS-B awareness | Polls 15 NM every 4 s (adsb.lol, or ADS-B Exchange with a key). Caution: < 3 NM & < 1,500 ft AGL. Warning: < 1.25 NM, low, closing speed > 0 → red marker + spoken callout | `src/lib/adsb.ts`, `useLiveData.ts` |
| Survey planner | Lawnmower / crosshatch grids from camera footprint and overlaps, GSD, photo interval, flight time; terrain elevation per waypoint keeps AGL constant | `src/lib/survey.ts` |
| AI copilot | Claude tool loop: `get_airspace_ceilings`, `get_terrain_elevation`, `generate_waypoints` (auto-validated against UASFM) | `src/lib/agent.ts` |
| Export | Litchi CSV, QGroundControl `.plan` (MAVLink, terrain-compensated relative altitude), DJI WPML `.kmz` | `src/lib/exporters.ts` |
| Weather | Nearest METAR, winds at 10/80/120 m, NOAA Kp, Part 107.51 visibility/cloud flags | `src/lib/weather.ts` |
| Checklists & FRAT | Pre-flight, takeoff, emergency, post-flight; auto-filled with weather and LAANC data; *Ready to Launch* locks until every mandatory gate is checked and weather is above minimums | `src/lib/checklist.ts` |
| Telemetry | Replay Airdata-style CSV or DJI `.SRT` logs in real time (1–10×); the drone marker drives ADS-B alerting | `src/lib/telemetry.ts` |
| Persistence | Missions saved to SQLite via Prisma | `prisma/schema.prisma`, `src/app/api/missions` |

## Implementation roadmap

1. **Foundation** — Next.js 15 HUD shell, MapLibre map, Zustand stores, Prisma/SQLite. ✅
2. **Airspace & LAANC engine** — UASFM + class airspace layers, waypoint validation, LAANC pre-check, provider adapter + simulator. ✅
3. **ADS-B situational awareness** — polling, threat classification, map markers, audio callouts. ✅
4. **Mission planning** — survey generator, terrain, Claude copilot, Litchi/QGC/DJI export, saved missions. ✅
5. **Ops readiness** — weather, Kp, checklists, FRAT, launch gate, telemetry replay. ✅

Next up: TFR/NOTAM layer, a live MAVLink → WebSocket telemetry bridge (`pymavlink`), real USS adapters (Aloft/Flyzone,
which need partner agreements), and saving flight logs/checklist runs (tables already in the schema).

## Notes

- **Verify DJI KMZ files** by importing them into DJI Pilot 2 / FlightHub 2 before flight. Set the aircraft (`droneEnumValue`) in the export panel.
- Litchi missions are limited to 99 waypoints; the UI flags larger plans.
- Not every aircraft broadcasts ADS-B. Proximity alerts supplement see-and-avoid; they do not replace it.
- The map style defaults to CARTO Dark Matter (no key); override it with `NEXT_PUBLIC_MAP_STYLE`.

## Tests

```bash
npm test   # LAANC rules, ADS-B threat logic, survey geometry, exporters, weather/telemetry parsers, checklist gate, agent tool loop (mocked)
```
