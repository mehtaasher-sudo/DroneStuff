export type ChecklistPhase = "preflight" | "takeoff" | "emergency" | "postflight";

export interface ChecklistItem {
  id: string;
  label: string;
  mandatory: boolean;
  /** Auto-filled value key from live data (weather / LAANC), shown beside the item. */
  autofill?: "metar_wind" | "metar_vis" | "metar_ceiling" | "kp" | "laanc" | "winds_aloft";
}

export interface ChecklistSection {
  phase: ChecklistPhase;
  title: string;
  /** Emergency procedures are reference-only and do not gate launch. */
  gatesLaunch: boolean;
  items: ChecklistItem[];
}

export const DEFAULT_CHECKLIST: ChecklistSection[] = [
  {
    phase: "preflight",
    title: "Pre-Flight — Airspace & Hardware",
    gatesLaunch: true,
    items: [
      { id: "pf-laanc", label: "Airspace authorization obtained or not required (LAANC ID)", mandatory: true, autofill: "laanc" },
      { id: "pf-tfr", label: "TFRs and NOTAMs checked for operating area", mandatory: true },
      { id: "pf-wx-wind", label: "Surface wind within aircraft limits", mandatory: true, autofill: "metar_wind" },
      { id: "pf-wx-aloft", label: "Winds at 80 m / 120 m within limits", mandatory: true, autofill: "winds_aloft" },
      { id: "pf-wx-vis", label: "Visibility ≥ 3 SM", mandatory: true, autofill: "metar_vis" },
      { id: "pf-wx-ceiling", label: "Remain 500 ft below cloud ceiling", mandatory: true, autofill: "metar_ceiling" },
      { id: "pf-kp", label: "Kp index reviewed for GNSS reliability", mandatory: false, autofill: "kp" },
      { id: "pf-remote-id", label: "Remote ID broadcasting and registration current", mandatory: true },
      { id: "pf-cert", label: "Remote pilot certificate / TRUST completion on person", mandatory: true },
      { id: "pf-props", label: "Propellers secure, undamaged", mandatory: true },
      { id: "pf-batt", label: "Flight & controller batteries charged and seated", mandatory: true },
      { id: "pf-sd", label: "Memory card inserted with free space", mandatory: false },
      { id: "pf-firmware", label: "Firmware/app current; compass and IMU OK", mandatory: true },
      { id: "pf-site", label: "Takeoff area clear; people/property briefed", mandatory: true },
      { id: "pf-rth", label: "Return-to-home altitude above obstacles", mandatory: true },
    ],
  },
  {
    phase: "takeoff",
    title: "Takeoff / Hover Check",
    gatesLaunch: true,
    items: [
      { id: "to-gnss", label: "GNSS lock and home point recorded", mandatory: true },
      { id: "to-hover", label: "Hover at 10 ft: stable, controls respond correctly", mandatory: true },
      { id: "to-link", label: "Control and video link strong", mandatory: true },
      { id: "to-vlos", label: "Visual observer in place / VLOS maintained", mandatory: true },
    ],
  },
  {
    phase: "emergency",
    title: "In-Flight Emergencies (reference)",
    gatesLaunch: false,
    items: [
      { id: "em-link", label: "Lost link: verify RTH engaged, track aircraft, notify ATC if in controlled airspace", mandatory: false },
      { id: "em-flyaway", label: "Flyaway: attempt ATTI/manual control, log position, contact ATC if needed", mandatory: false },
      { id: "em-traffic", label: "Manned traffic conflict: descend and yield right-of-way immediately (107.37)", mandatory: false },
      { id: "em-battery", label: "Low battery: land at nearest safe location", mandatory: false },
    ],
  },
  {
    phase: "postflight",
    title: "Post-Flight — Battery & Media Log",
    gatesLaunch: false,
    items: [
      { id: "po-power", label: "Aircraft powered off before controller", mandatory: true },
      { id: "po-batt", label: "Battery temperature and cycle count logged", mandatory: true },
      { id: "po-media", label: "Media offloaded and backed up", mandatory: true },
      { id: "po-damage", label: "Airframe inspected for damage", mandatory: true },
      { id: "po-log", label: "Flight logged (time, location, LAANC ID)", mandatory: true },
    ],
  },
];

/** "Ready to Launch" only when every mandatory item in launch-gating sections is checked and no weather no-go exists. */
export function launchGate(sections: ChecklistSection[], checked: Record<string, boolean>, weatherNoGo = false) {
  const missing = sections
    .filter((s) => s.gatesLaunch)
    .flatMap((s) => s.items.filter((i) => i.mandatory && !checked[i.id]));
  return { ready: missing.length === 0 && !weatherNoGo, missing, weatherNoGo };
}

/** Flight Risk Assessment Tool: each factor scores 0-3; totals map to low / medium / high. */
export const FRAT_FACTORS = [
  { id: "wind", label: "Wind / gusts", options: ["< 10 kt", "10–15 kt", "15–20 kt", "> 20 kt"] },
  { id: "airspace", label: "Airspace", options: ["Class G", "Controlled, auto-approval", "Further coordination", "Near airport / heliport ops"] },
  { id: "crowd", label: "People / property", options: ["Unpopulated", "Sparse", "Moderate", "Over people / roads"] },
  { id: "light", label: "Lighting", options: ["Day", "Civil twilight", "Night, lit", "Night, marginal"] },
  { id: "pilot", label: "Pilot currency / fatigue", options: ["Current, rested", "Minor fatigue", "> 90 days since flight", "Fatigued / unfamiliar aircraft"] },
  { id: "terrain", label: "Terrain / obstacles", options: ["Open", "Some obstacles", "Towers / wires", "Confined / urban canyon"] },
] as const;

export function fratScore(values: Record<string, number>) {
  const total = FRAT_FACTORS.reduce((s, f) => s + (values[f.id] ?? 0), 0);
  const level = total <= 5 ? "low" : total <= 10 ? "medium" : "high";
  return { total, max: FRAT_FACTORS.length * 3, level } as const;
}
