import express from "express";
import path from "node:path";
import { authOptional } from "./middleware/auth";
import { authRoutes } from "./modules/auth/routes";
import { emailOtpRoutes } from "./modules/auth/emailotp";
import { googleAuthRoutes } from "./modules/auth/google";
import { meRoutes } from "./modules/me/routes";
import { scansRoutes } from "./modules/scans/routes";
import { doctorRoutes } from "./modules/doctor/routes";
import { shopRoutes } from "./modules/shop/routes";
import { consultsRoutes } from "./modules/consults/routes";
import { coachRoutes } from "./modules/coach/routes";
import { adminRoutes } from "./modules/admin/routes";
import { notificationRoutes } from "./modules/notifications/routes";
import { aiRoutes } from "./modules/ai/routes";
import { contentRoutes } from "./modules/content/routes";
import { communityRoutes } from "./modules/community/routes";
import { growthRoutes } from "./modules/growth/routes";
import { nutritionRoutes } from "./modules/nutrition/routes";
import { journeyRoutes } from "./modules/journey/routes";
import { returnsRoutes } from "./modules/returns/routes";
import { labsRoutes } from "./modules/labs/routes";
import { familyRoutes } from "./modules/family/routes";
import { syncRoutes } from "./modules/sync/routes";
import { trackingRoutes } from "./modules/tracking/routes";
import { systemRoutes } from "./modules/system/routes";
import { errorMiddleware, notFound } from "./http";
import { setEmailLogger } from "./lib/brevo";
import type { Deps } from "./deps";

export interface AppOptions {
  clientDist?: string;
  version?: string;
}

export function buildApp(deps: Deps, opts: AppOptions = {}) {
  // A37: central email logging — every Brevo send/skip/fail lands in email_logs.
  // Fire-and-forget; a logging failure must never break the request path.
  setEmailLogger((e) => {
    deps.store.logEmail(e).catch((err) => console.error("[email-log] store write failed:", err));
  });
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "2mb" }));

  const api = express.Router();
  api.use(authOptional(deps.jwtSecret));
  api.use("/auth", authRoutes(deps));
  api.use("/auth", emailOtpRoutes(deps));
  api.use("/auth", googleAuthRoutes(deps));
  api.use("/me", meRoutes(deps));
  api.use("/scans", scansRoutes(deps));
  api.use("/doctor", doctorRoutes(deps));
  api.use("/consults", consultsRoutes(deps));
  api.use("/coach", coachRoutes(deps));
  api.use("/admin", adminRoutes(deps));
  api.use("/notifications", notificationRoutes(deps));
  api.use("/ai", aiRoutes(deps));
  api.use("/content", contentRoutes(deps));
  api.use("/community", communityRoutes(deps));
  api.use("/growth", growthRoutes(deps));
  api.use("/nutrition", nutritionRoutes(deps));
  api.use("/journey", journeyRoutes(deps));
  api.use("/returns", returnsRoutes(deps));
  api.use("/labs", labsRoutes(deps));
  api.use("/family", familyRoutes(deps));
  api.use("/sync", syncRoutes(deps));
  api.use("/tracking", trackingRoutes(deps));
  api.use("/app", systemRoutes(deps)); // public: no auth
  api.use("/", shopRoutes(deps)); // /kits, /orders, /payments/:provider/callback, /pharmacy/...
  app.use("/api/v1", api);

  app.get("/health", (_req, res) => res.json({ ok: true, version: opts.version ?? "0.1.0" }));

  // serve the PWA client + SPA fallback (after API routes)
  const dist = opts.clientDist ?? path.resolve(__dirname, "../../client/dist");
  app.use(express.static(dist, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next(notFound("Not found."));
    res.sendFile(path.join(dist, "index.html"), (err) => {
      if (err) next(notFound("Not found."));
    });
  });

  app.use(errorMiddleware);
  return app;
}
