import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLang } from "../i18n/LanguageContext";

/**
 * Cold-start splash screen. Shown once per app launch (not on navigation):
 * deep-green gradient, CSS-only drifting leaf particles, logo pop-in,
 * wordmark + tagline, and a thin gold progress line while the app boots.
 *
 * Dismissal: at least MIN_MS, and no later than MAX_MS — whichever comes
 * first once `ready` (auth restore finished) is true.
 */
const MIN_MS = 1800;
const MAX_MS = 3000;
const FADE_MS = 480;

interface Particle {
  left: string;
  size: number;
  duration: string;
  delay: string;
  opacity: number;
}

// Deterministic particle field — stable across renders, no libraries.
const PARTICLES: Particle[] = Array.from({ length: 16 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    left: `${(r(1) * 100).toFixed(1)}%`,
    size: 6 + Math.floor(r(2) * 10),
    duration: `${7 + r(3) * 8}s`,
    delay: `${(-r(4) * 12).toFixed(1)}s`,
    opacity: 0.25 + r(5) * 0.4,
  };
});

export default function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const { t } = useLang();
  const [leaving, setLeaving] = useState(false);
  const startRef = useRef<number>(0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  if (startRef.current === 0) startRef.current = Date.now();

  const dismiss = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    window.setTimeout(() => onDoneRef.current(), FADE_MS);
  }, []);

  useEffect(() => {
    const elapsed = Date.now() - startRef.current;
    const wait = Math.max(0, MIN_MS - elapsed); // show at least ~1.8s
    const cap = Math.max(0, MAX_MS - elapsed);  // never longer than ~3s
    const t1 = window.setTimeout(() => {
      if (ready) dismiss();
    }, wait);
    const t2 = window.setTimeout(dismiss, cap);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [ready, dismiss]);

  return (
    <div className={`splash${leaving ? " splash-leave" : ""}`} role="status" aria-label={t("common.appName")}>
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="splash-particle"
          aria-hidden="true"
          style={
            {
              left: p.left,
              width: p.size,
              height: p.size,
              animationDuration: p.duration,
              animationDelay: p.delay,
              "--po": p.opacity,
            } as CSSProperties
          }
        />
      ))}
      <div className="splash-inner">
        <img className="splash-logo" src="/logo.png" alt="Jaraa" />
        <div className="splash-word">{t("common.appName")}</div>
        <div className="splash-tag">{t("common.tagline")}</div>
        <div className="splash-bar" aria-hidden="true">
          <div className="splash-bar-fill" />
        </div>
        <div className="splash-loading">{t("splash.loading")}</div>
      </div>
    </div>
  );
}
