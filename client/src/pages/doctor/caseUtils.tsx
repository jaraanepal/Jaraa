import type { Case, RootKey, ScanDetail } from "../../api/types";

/**
 * Shared helpers for the doctor workflow views.
 *
 * SLA states are derived from the case's sla_due_at (24h review window):
 * overdue = red, under 6h left = amber, otherwise green.
 */

export type SlaState = "overdue" | "due6h" | "ok";

export function slaState(c: Case): SlaState {
  const left = new Date(c.sla_due_at).getTime() - Date.now();
  if (left <= 0) return "overdue";
  if (left < 6 * 3600_000) return "due6h";
  return "ok";
}

/** Fraction of the 24h review window still remaining, clamped 0..1. */
export function slaRemainingFrac(c: Case): number {
  const left = new Date(c.sla_due_at).getTime() - Date.now();
  return Math.max(0, Math.min(1, left / (24 * 3600_000)));
}

export function waitMs(c: Case): number {
  return Math.max(0, Date.now() - new Date(c.created_at).getTime());
}

/** Compact "45m" / "3h" / "2d" duration string. */
export function msShort(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function waitShort(c: Case): string {
  return msShort(waitMs(c));
}

/** Lower sorts first: red-flag, then high priority, then earliest SLA deadline. */
export function urgencyRank(c: Case): number {
  const p = c.priority === "red_flag" ? 0 : c.priority === "high" ? 1 : 2;
  return p * 1e15 + new Date(c.sla_due_at).getTime();
}

/** The n weakest roots of a scan, ascending by score. Empty when no scores. */
export function weakestRoots(scan: ScanDetail | undefined, n = 3): RootKey[] {
  if (!scan?.root_scores) return [];
  const rs = scan.root_scores;
  return (Object.keys(rs) as RootKey[])
    .sort((a, b) => rs[a].score - rs[b].score)
    .slice(0, n);
}

type T = (k: string, vars?: Record<string, string | number>) => string;

/**
 * Visual SLA countdown bar for one case.
 * Red when overdue, amber when under 6h remain, green otherwise.
 */
export function SlaBar({ c, t }: { c: Case; t: T }) {
  const st = slaState(c);
  const frac = slaRemainingFrac(c);
  const color = st === "overdue" ? "var(--bad)" : st === "due6h" ? "#8a5a06" : "var(--green)";
  const h = Math.max(0, Math.ceil((new Date(c.sla_due_at).getTime() - Date.now()) / 3600_000));
  return (
    <div style={{ margin: "6px 0 2px" }}>
      <div
        style={{ height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}
        role="img"
        aria-label={st === "overdue" ? t("doctorDash.slaOverdue") : t("doctorDash.slaLeft", { n: h })}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(frac * 100)}%`,
            background: color,
            borderRadius: 999,
          }}
        />
      </div>
      <div className="tiny" style={{ color, fontWeight: 700, marginTop: 2 }}>
        {st === "overdue" ? t("doctorDash.slaOverdue") : t("doctorDash.slaLeft", { n: h })}
      </div>
    </div>
  );
}
