import { useEffect, useRef } from "react";
import { scoreColor, scoreWordKey } from "../lib/rootmap";
import { useLang } from "../i18n/LanguageContext";
import { Icon } from "./icons";

/* ---------------- toast (imperative, app-wide singleton) --- */
let toastFn: ((msg: string) => void) | null = null;
export function toast(msg: string) {
  toastFn?.(msg);
}
export function ToastHost() {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);
  useEffect(() => {
    toastFn = (msg: string) => {
      const el = ref.current;
      if (!el) return;
      el.textContent = msg;
      el.style.display = "block";
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        el.style.display = "none";
      }, 2600);
    };
    return () => {
      toastFn = null;
    };
  }, []);
  return <div className="toast" ref={ref} role="status" aria-live="polite" />;
}

/* ---------------- modal --- */
export function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modalwrap"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal">{children}</div>
    </div>
  );
}

/* ---------------- small building blocks --- */
export function Chip({ tone, children }: { tone?: "red" | "amber" | "gold" | "grey"; children: React.ReactNode }) {
  return <span className={`chip${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

export function ScoreBar({ score }: { score: number }) {
  return (
    <div className="scorebar" role="img" aria-label={`${score}/100`}>
      <i style={{ width: `${score}%`, background: scoreColor(score) }} />
    </div>
  );
}

export function ScoreLabel({ score }: { score: number }) {
  const { t } = useLang();
  return <Chip tone={score >= 70 ? undefined : score >= 40 ? "amber" : "red"}>{score} · {t(`jara.scoreWord.${scoreWordKey(score)}`)}</Chip>;
}

export function NoticeBox({ tone, title, children }: { tone: "flag" | "notice" | "ok"; title: string; children: React.ReactNode }) {
  const cls = tone === "flag" ? "flagbox" : tone === "notice" ? "noticebox" : "okbox";
  const icon = tone === "flag" ? <Icon.alert size={18} /> : tone === "notice" ? <Icon.clock size={18} /> : <Icon.check size={18} />;
  return (
    <div className={cls}>
      <h3>
        <span style={{ display: "inline-flex", verticalAlign: "-3px", marginRight: 6 }}>{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLang();
  return (
    <div className="errbox">
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn-s" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function Loading() {
  const { t } = useLang();
  return (
    <div aria-busy="true" aria-label={t("common.loading")}>
      <div className="skeleton" style={{ height: 28, margin: "8px 0" }} />
      <div className="skeleton" style={{ height: 120, margin: "8px 0" }} />
      <div className="skeleton" style={{ height: 20, width: "60%", margin: "8px 0" }} />
    </div>
  );
}

/** Dashboard stat card — label + big value, icon optional. Never fake: pass "—" when unknown. */
export function StatCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="statcard">
      {icon && <span className="staticon" aria-hidden="true">{icon}</span>}
      <div>
        <div className="statvalue">{value}</div>
        <div className="statlabel">{label}</div>
      </div>
    </div>
  );
}

/** Honest empty state: names what isn't there yet, optionally a CTA. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon" aria-hidden="true">{icon}</div>}
      <b>{title}</b>
      {body && <p className="muted tiny">{body}</p>}
      {action}
    </div>
  );
}

/** Friendly copy for API error codes (bilingual via the errors.* dict). */
export function apiErrorMessage(t: (k: string) => string, err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: string }).code);
    const key = `errors.${code}`;
    const s = t(key);
    if (s !== key) return s;
    if ("message" in err && typeof (err as { message: string }).message === "string") {
      return (err as { message: string }).message;
    }
  }
  if (err instanceof TypeError) return t("errors.network");
  return t("errors.unknown");
}
