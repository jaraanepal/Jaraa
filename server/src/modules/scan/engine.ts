// Adaptive scan engine: stage transitions + path activation from scan_rules.
// Rules are evaluated in priority order; copy lives in the DB (admin-editable).
import { HttpError } from "../../http";
import type { ScanRule } from "../../db/types";

export const STAGES = ["kahani", "lens", "jara", "root_map"] as const;
export type Stage = (typeof STAGES)[number];

export function stageName(n: number): Stage {
  if (n < 1 || n > 4) throw new HttpError(400, "validation_error", "invalid stage");
  return STAGES[n - 1];
}
export function stageNumber(name: string): number {
  const i = STAGES.indexOf(name as Stage);
  if (i < 0) throw new HttpError(400, "validation_error", `unknown stage: ${name}`);
  return i + 1;
}
export function stagesCompleted(current: number): Stage[] {
  return STAGES.slice(0, current - 1) as Stage[];
}

/** Only forward-by-one (or staying) transitions are legal. */
export function validateTransition(from: number, to: number): void {
  if (to === from) return; // idempotent re-entry
  if (to !== from + 1) {
    throw new HttpError(422, "validation_error",
      `Cannot jump from '${stageName(from)}' to '${stageName(to)}'. Complete '${stageName(from + 1)}' first.`,
      { from: stageName(from), to: stageName(to), allowed_next: [stageName(from + 1)] });
  }
}

export interface EngineContext {
  pins: { event_type: string; occurred_on?: string | null; followup_answers: Record<string, unknown> }[];
  answers: Record<string, unknown>;
  profile?: { age_band?: string | null; gender?: string | null };
  hasUnresolvedRedFlag: boolean;
}

/**
 * Evaluate active scan_rules against the context. Returns path names in
 * priority order. Seeded rule triggers understood:
 *  - {pin, within_months} / {pin} -> pin present (optionally within N months)
 *  - {any_red_flag: true} -> unresolved red flag exists
 *  - {age_band, gender} -> profile match
 *  - {only_pin} -> the only pin type present
 *  - {} -> default (standard)
 */
export function evaluatePaths(rules: ScanRule[], ctx: EngineContext): string[] {
  const paths: string[] = [];
  for (const rule of rules) {
    const c = rule.trigger_condition ?? {};
    if (matches(c, ctx)) {
      const path = pathFor(rule);
      if (path && !paths.includes(path)) paths.push(path);
    }
  }
  return paths.length ? paths : ["standard"];
}

function pathFor(rule: ScanRule): string | null {
  if (rule.action === "activate_path") {
    const p = (rule.action_params as { path?: string }).path;
    return p ?? null;
  }
  if (rule.action === "standard_path") return "standard";
  if (rule.action === "raise_flag") return "medical-flag";
  if (rule.action === "extra_questions") return "sparse-story";
  if (rule.action === "prune") return "young-starter";
  return null;
}

function matches(c: Record<string, unknown>, ctx: EngineContext): boolean {
  if (Object.keys(c).length === 0) return true;
  if (c.any_red_flag === true) return ctx.hasUnresolvedRedFlag;
  if (typeof c.pin === "string") {
    const pin = ctx.pins.find((p) => p.event_type === c.pin);
    if (!pin) return false;
    if (typeof c.within_months === "number" && pin.occurred_on) {
      const months = (Date.now() - new Date(pin.occurred_on).getTime()) / (30.44 * 86_400_000);
      if (months > (c.within_months as number)) return false;
    }
    if (c.still_taking === true) {
      return pin.followup_answers?.still_taking === true;
    }
    return true;
  }
  if (typeof c.only_pin === "string") {
    return ctx.pins.length > 0 && ctx.pins.every((p) => p.event_type === c.only_pin);
  }
  if (typeof c.age_band === "string" || typeof c.gender === "string") {
    if (c.age_band && ctx.profile?.age_band !== c.age_band) return false;
    if (c.gender && ctx.profile?.gender !== c.gender) return false;
    return true;
  }
  if (typeof c.sleep_hours_lt === "number" && c.pin === undefined) {
    const s = Number(ctx.answers.sleep_hours);
    return Number.isFinite(s) && s < (c.sleep_hours_lt as number);
  }
  return false;
}

/** Contract Scan shape from a DB row. */
export function toContractScan(scan: {
  id: string; user_id: string | null; status: string; current_stage: number;
  version: number; created_at: string; updated_at: string;
}, redFlagsCount: number) {
  return {
    id: scan.id,
    user_id: scan.user_id,
    status: scan.status,
    current_stage: stageName(scan.current_stage),
    stages_completed: stagesCompleted(scan.current_stage),
    version: scan.version,
    red_flags_count: redFlagsCount,
    created_at: scan.created_at,
    updated_at: scan.updated_at,
  };
}
