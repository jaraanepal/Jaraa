import { useLang } from "../i18n/LanguageContext";

interface Props {
  /** 0–100 */
  percent: number;
  size?: number;
}

/**
 * U10 — SVG adherence ring: % of days with a check-in, drawn as a
 * progress ring with a bilingual label underneath. Reusable anywhere
 * a plan-adherence summary is shown.
 */
export default function AdherenceRing({ percent, size = 120 }: Props) {
  const { t } = useLang();
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const r = 54;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;

  return (
    <div className="center" style={{ padding: "8px 0" }} role="img" aria-label={`${t("p12.customer.adherenceRing")}: ${pct}%`}>
      <svg width={size} height={size} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--green)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="68" textAnchor="middle" fontSize="24" fontWeight="800" fill="var(--ink)">
          {pct}%
        </text>
      </svg>
      <p className="tiny muted" style={{ margin: "6px 0 0" }}>{t("p12.customer.adherenceRing")}</p>
    </div>
  );
}
