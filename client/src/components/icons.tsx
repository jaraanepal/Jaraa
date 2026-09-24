/**
 * Inline SVG icons — the UI never uses emojis; meaning is carried by
 * icon + text label (flow doc G5: no color-only meaning).
 */
interface P { size?: number; className?: string }

function base(size = 22, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

export const Icon = {
  home: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></svg>
  ),
  scan: (p: P) => (
    <svg {...base(p.size, p.className)}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" /></svg>
  ),
  plan: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
  ),
  chart: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M3 3v18h18" /><path d="M7 15l4-6 4 3 5-8" /></svg>
  ),
  box: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></svg>
  ),
  camera: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
  ),
  chat: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
  ),
  video: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
  ),
  pin: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
  ),
  clock: (p: P) => (
    <svg {...base(p.size, p.className)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
  ),
  check: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M20 6L9 17l-5-5" /></svg>
  ),
  cross: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M18 6L6 18M6 6l12 12" /></svg>
  ),
  alert: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
  ),
  leaf: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M11 20A7 7 0 0 1 4 13c0-4 3-8 9-10 4-1.4 7-1 7-1s.4 3-1 7c-2 6-6 9-8 11z" /><path d="M4 21c4-6 8-9 12-11" /></svg>
  ),
  logout: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
  ),
  lock: (p: P) => (
    <svg {...base(p.size, p.className)}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
  ),
  truck: (p: P) => (
    <svg {...base(p.size, p.className)}><rect x="1" y="4" width="14" height="12" rx="1" /><path d="M15 8h4l4 4v4h-8V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
  ),
  book: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
  ),
  gear: (p: P) => (
    <svg {...base(p.size, p.className)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
  ),
  doc: (p: P) => (
    <svg {...base(p.size, p.className)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8" /></svg>
  ),
};
