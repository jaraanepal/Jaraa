import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// U18: apply the persisted theme before first paint.
try {
  const stored = localStorage.getItem("jaraa-theme");
  const theme = stored ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
} catch { /* ignore */ }

// U47 (batch 4): apply the persisted text size before first paint.
try {
  const ts = localStorage.getItem("jaraa:text-size");
  const px = ts === "small" ? 14 : ts === "large" ? 18 : 16;
  document.documentElement.style.fontSize = `${px}px`;
} catch { /* ignore */ }

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Hand-written service worker: cache-first app shell, network-first /api,
// offline fallback. Registration is idempotent across reloads.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline-first: the app still works from cache without SW */
    });
  });
}
