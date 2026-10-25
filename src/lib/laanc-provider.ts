import type { Feature, Polygon } from "geojson";
import type { LaancPrecheck } from "./laanc";

export interface LaancSubmission {
  provider: string;
  /** Authorization reference. Simulator IDs start with "SIM-" and are NOT valid FAA authorizations. */
  reference: string;
  state: "approved" | "pending_coordination" | "rejected";
  simulated: boolean;
  message: string;
  submittedAt: string;
}

export interface LaancRequest {
  precheck: LaancPrecheck;
  area: Feature<Polygon>;
  start: string;
  end: string;
  rule: "part107" | "44809";
  pilot?: { name: string; phone?: string; certificate?: string };
}

/**
 * Pluggable LAANC provider. Real submissions go through an FAA-approved UAS Service Supplier
 * (e.g. Aloft, Flyzone) under a partner agreement; implement this interface with their SDK/API
 * and select it with LAANC_PROVIDER.
 */
export interface LaancProvider {
  name: string;
  submit(req: LaancRequest): Promise<LaancSubmission>;
}

/** Local auto-approval simulator: mirrors LAANC's decision rules against UASFM ceilings for training and testing. */
export const simulatorProvider: LaancProvider = {
  name: "AeroCommand LAANC Simulator",
  async submit(req) {
    const id = `SIM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const base = { provider: this.name, reference: id, simulated: true, submittedAt: new Date().toISOString() };
    switch (req.precheck.status) {
      case "auto_approval":
        return { ...base, state: "approved", message: `Simulated auto-approval up to ${req.precheck.target_alt_agl_ft} ft AGL. Not a valid FAA authorization.` };
      case "further_coordination":
        return { ...base, state: "pending_coordination", message: "Simulated further-coordination request queued. Real requests require ≥72 h lead time." };
      case "no_laanc_grid":
        return { ...base, state: "rejected", message: "No UASFM grid here — LAANC does not apply. Confirm the airspace class." };
      default:
        return { ...base, state: "rejected", message: req.precheck.headline };
    }
  },
};

export function getLaancProvider(): LaancProvider {
  const name = (process.env.LAANC_PROVIDER ?? "simulator").toLowerCase();
  if (name !== "simulator") {
    throw new Error(`LAANC provider "${name}" is not implemented. Add an adapter in src/lib/laanc-provider.ts or use LAANC_PROVIDER=simulator.`);
  }
  return simulatorProvider;
}
