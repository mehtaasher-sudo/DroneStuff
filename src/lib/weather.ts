export interface MetarSummary {
  station: string;
  name: string | null;
  observed: string | null;
  raw: string;
  wind_dir_deg: number | "VRB" | null;
  wind_kt: number | null;
  gust_kt: number | null;
  /** Statute miles; "10+" reported as 10 with `visibility_plus`. */
  visibility_sm: number | null;
  visibility_plus: boolean;
  /** Lowest broken/overcast/obscured layer, feet AGL. */
  ceiling_ft_agl: number | null;
  temp_c: number | null;
  dewpoint_c: number | null;
  altimeter_hpa: number | null;
  flight_category: string | null;
  lat: number | null;
  lon: number | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parses one record from aviationweather.gov /api/data/metar?format=json. */
export function parseMetar(r: Record<string, unknown>): MetarSummary {
  const visRaw = r.visib;
  let vis: number | null = num(visRaw);
  let plus = false;
  if (typeof visRaw === "string") {
    plus = visRaw.includes("+");
    const parsed = parseFloat(visRaw);
    vis = Number.isFinite(parsed) ? parsed : null;
  }
  const clouds = Array.isArray(r.clouds) ? (r.clouds as { cover?: string; base?: number | null }[]) : [];
  const ceilings = clouds
    .filter((c) => ["BKN", "OVC", "OVX", "VV"].includes(String(c.cover)) && typeof c.base === "number")
    .map((c) => c.base as number);
  const obs = num(r.obsTime);
  return {
    station: String(r.icaoId ?? ""),
    name: typeof r.name === "string" ? r.name : null,
    observed: obs ? new Date(obs * 1000).toISOString() : typeof r.reportTime === "string" ? r.reportTime : null,
    raw: String(r.rawOb ?? ""),
    wind_dir_deg: r.wdir === "VRB" ? "VRB" : num(r.wdir),
    wind_kt: num(r.wspd),
    gust_kt: num(r.wgst),
    visibility_sm: vis,
    visibility_plus: plus,
    ceiling_ft_agl: ceilings.length ? Math.min(...ceilings) : null,
    temp_c: num(r.temp),
    dewpoint_c: num(r.dewp),
    altimeter_hpa: num(r.altim),
    flight_category: typeof r.fltCat === "string" ? r.fltCat : null,
    lat: num(r.lat),
    lon: num(r.lon),
  };
}

/** Latest planetary Kp from NOAA SWPC noaa-planetary-k-index.json (array-of-arrays with header, or array of objects). */
export function parseKp(body: unknown): { kp: number; time: string } | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const last = body[body.length - 1];
  if (Array.isArray(last)) {
    const header = body[0] as string[];
    const ki = header.findIndex((h) => String(h).toLowerCase() === "kp");
    const ti = header.findIndex((h) => String(h).toLowerCase() === "time_tag");
    const kp = parseFloat(String(last[ki >= 0 ? ki : 1]));
    return Number.isFinite(kp) ? { kp, time: String(last[ti >= 0 ? ti : 0]) } : null;
  }
  const o = last as Record<string, unknown>;
  const kp = Number(o.Kp ?? o.kp ?? o.kp_index ?? o.estimated_kp);
  return Number.isFinite(kp) ? { kp, time: String(o.time_tag ?? "") } : null;
}

export interface WindsAloft {
  time: string;
  /** Knots at 10 m, 80 m and 120 m above ground. */
  wind_10m_kt: number | null;
  wind_80m_kt: number | null;
  wind_120m_kt: number | null;
  dir_10m: number | null;
  dir_80m: number | null;
  dir_120m: number | null;
  gust_10m_kt: number | null;
}

/** Picks the hour closest to `now` from an Open-Meteo hourly forecast (requested with wind_speed_unit=kn, timezone=GMT). */
export function parseOpenMeteo(body: unknown, now = new Date()): WindsAloft | null {
  const h = (body as { hourly?: Record<string, unknown[]> })?.hourly;
  if (!h?.time?.length) return null;
  const times = h.time.map((t) => Date.parse(`${t}Z`));
  let idx = 0;
  times.forEach((t, i) => {
    if (Math.abs(t - now.getTime()) < Math.abs(times[idx] - now.getTime())) idx = i;
  });
  const at = (k: string) => num(h[k]?.[idx]);
  return {
    time: `${h.time[idx]}Z`,
    wind_10m_kt: at("wind_speed_10m"),
    wind_80m_kt: at("wind_speed_80m"),
    wind_120m_kt: at("wind_speed_120m"),
    dir_10m: at("wind_direction_10m"),
    dir_80m: at("wind_direction_80m"),
    dir_120m: at("wind_direction_120m"),
    gust_10m_kt: at("wind_gusts_10m"),
  };
}

/** Part 107.51(c): at least 3 statute miles flight visibility; 107.51(d): 500 ft below / 2,000 ft horizontal from clouds. */
export function weatherFlags(m: MetarSummary | null, w: WindsAloft | null, kp: number | null, maxWindKt = 20) {
  const flags: { level: "ok" | "caution" | "nogo"; text: string }[] = [];
  if (m?.visibility_sm !== null && m?.visibility_sm !== undefined) {
    flags.push(m.visibility_sm < 3
      ? { level: "nogo", text: `Visibility ${m.visibility_sm} SM < 3 SM (Part 107.51)` }
      : { level: "ok", text: `Visibility ${m.visibility_sm}${m.visibility_plus ? "+" : ""} SM` });
  }
  if (m?.ceiling_ft_agl !== null && m?.ceiling_ft_agl !== undefined && m.ceiling_ft_agl < 900) {
    flags.push({ level: "caution", text: `Ceiling ${m.ceiling_ft_agl} ft — keep 500 ft below clouds (max ${Math.max(0, m.ceiling_ft_agl - 500)} ft AGL)` });
  }
  const winds = [m?.gust_kt, m?.wind_kt, w?.wind_120m_kt, w?.gust_10m_kt].filter((x): x is number => typeof x === "number");
  if (winds.length) {
    const max = Math.max(...winds);
    flags.push(max > maxWindKt
      ? { level: "caution", text: `Wind up to ${Math.round(max)} kt exceeds ${maxWindKt} kt limit` }
      : { level: "ok", text: `Max wind ${Math.round(max)} kt` });
  }
  if (kp !== null) {
    flags.push(kp >= 5
      ? { level: "caution", text: `Kp ${kp}: geomagnetic storm — GNSS accuracy may degrade` }
      : { level: "ok", text: `Kp ${kp}` });
  }
  return flags;
}
