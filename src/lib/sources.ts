import type { BBox, UasfmCollection } from "./types";
import { parseAdsbResponse } from "./adsb";
import { parseKp, parseMetar, parseOpenMeteo } from "./weather";
import { MAX_BBOX_SPAN_DEG } from "./bbox";

export { MAX_BBOX_SPAN_DEG };

export const SOURCES = {
  uasfm:
    process.env.FAA_UASFM_URL ||
    "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/FAA_UAS_FacilityMap_Data/FeatureServer/0/query",
  classAirspace:
    process.env.FAA_CLASS_AIRSPACE_URL ||
    "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query",
  adsbLol: "https://api.adsb.lol/v2/point",
  adsbxHost: "adsbexchange-com1.p.rapidapi.com",
  metar: "https://aviationweather.gov/api/data/metar",
  openMeteo: "https://api.open-meteo.com/v1/forecast",
  elevation: "https://api.open-meteo.com/v1/elevation",
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
};

const UA = { "User-Agent": "AeroCommand/0.1 (sUAS planning)" };

export function parseBBox(s: string | null): BBox {
  const parts = (s ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error("bbox must be west,south,east,north");
  const [w, so, e, n] = parts;
  if (e <= w || n <= so) throw new Error("bbox east/north must exceed west/south");
  if (e - w > MAX_BBOX_SPAN_DEG || n - so > MAX_BBOX_SPAN_DEG) throw new Error(`bbox span must be ≤ ${MAX_BBOX_SPAN_DEG}° — zoom in`);
  return [w, so, e, n];
}

async function getJson(url: string, init?: RequestInit & { revalidate?: number }) {
  const res = await fetch(url, { ...init, headers: { ...UA, ...init?.headers }, next: { revalidate: init?.revalidate ?? 0 } });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

/** Queries an ArcGIS FeatureServer layer by bbox as GeoJSON, following pagination up to `maxPages`. */
export async function arcgisBBox(url: string, bbox: BBox, outFields = "*", maxPages = 5) {
  const features: unknown[] = [];
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({
      where: "1=1",
      geometry: bbox.join(","),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields,
      outSR: "4326",
      f: "geojson",
      resultOffset: String(page * 2000),
      resultRecordCount: "2000",
    });
    const body = await getJson(`${url}?${q}`, { revalidate: 86400 });
    if (body.error) throw new Error(`ArcGIS: ${body.error.message ?? "query failed"}`);
    features.push(...(body.features ?? []));
    const more = body.exceededTransferLimit ?? body.properties?.exceededTransferLimit;
    if (!more) break;
  }
  return { type: "FeatureCollection" as const, features };
}

export async function fetchUasfm(bbox: BBox): Promise<UasfmCollection> {
  const fc = await arcgisBBox(SOURCES.uasfm, bbox, "CEILING,APT1_FAAID,APT1_NAME,UNIT,LAST_EDIT");
  return fc as UasfmCollection;
}

export async function fetchTraffic(lat: number, lon: number, radiusNm: number) {
  const key = process.env.ADSBX_API_KEY;
  const r = Math.min(Math.max(radiusNm, 1), 250);
  if (key) {
    const body = await getJson(`https://${SOURCES.adsbxHost}/v2/lat/${lat}/lon/${lon}/dist/${Math.min(r, 250)}/`, {
      headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": SOURCES.adsbxHost },
    });
    return { source: "ADS-B Exchange", aircraft: parseAdsbResponse(body) };
  }
  const body = await getJson(`${SOURCES.adsbLol}/${lat.toFixed(5)}/${lon.toFixed(5)}/${r}`);
  return { source: "adsb.lol", aircraft: parseAdsbResponse(body) };
}

/** Terrain elevation in feet MSL from Open-Meteo (Copernicus 90 m DEM), batched 100 points per call. */
export async function fetchElevationFt(points: { lat: number; lon: number }[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const q = new URLSearchParams({
      latitude: chunk.map((p) => p.lat.toFixed(6)).join(","),
      longitude: chunk.map((p) => p.lon.toFixed(6)).join(","),
    });
    const body = await getJson(`${SOURCES.elevation}?${q}`, { revalidate: 86400 });
    out.push(...(body.elevation as number[]).map((m) => Math.round(m * 3.28084)));
  }
  return out;
}

export async function fetchWeather(lat: number, lon: number) {
  const d = 1;
  const bbox = [lat - d, lon - d, lat + d, lon + d].map((n) => n.toFixed(3)).join(",");
  const meteoQ = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_direction_10m,wind_direction_80m,wind_direction_120m,wind_gusts_10m",
    wind_speed_unit: "kn",
    timezone: "GMT",
    forecast_days: "2",
  });
  const [metarRes, meteoRes, kpRes] = await Promise.allSettled([
    getJson(`${SOURCES.metar}?bbox=${bbox}&format=json`),
    getJson(`${SOURCES.openMeteo}?${meteoQ}`),
    getJson(SOURCES.kp),
  ]);
  let metar = null;
  if (metarRes.status === "fulfilled" && Array.isArray(metarRes.value)) {
    const parsed = (metarRes.value as Record<string, unknown>[]).map(parseMetar).filter((m) => m.lat !== null);
    parsed.sort((a, b) => dist2(a, lat, lon) - dist2(b, lat, lon));
    metar = parsed[0] ?? null;
  }
  const errors = [metarRes, meteoRes, kpRes].filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? r));
  return {
    metar,
    winds: meteoRes.status === "fulfilled" ? parseOpenMeteo(meteoRes.value) : null,
    kp: kpRes.status === "fulfilled" ? parseKp(kpRes.value) : null,
    errors,
  };
}

const dist2 = (m: { lat: number | null; lon: number | null }, lat: number, lon: number) =>
  ((m.lat ?? 0) - lat) ** 2 + (((m.lon ?? 0) - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
