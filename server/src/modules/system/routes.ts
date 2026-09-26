// Public system endpoints. GET /app/version serves the forced-update check
// for the Android client. Rabindra-owned: host the JSON + APK and set
// APP_LATEST_VERSION_CODE / APP_APK_URL / APP_FORCE_UPDATE in Render. Until
// set (versionCode 0), the endpoint honestly reports configured:false and
// apps must treat that as "no update info" — no nag, no block.
import { Router } from "express";
import { asyncHandler } from "../../http";
import { env } from "../../env";
import type { Deps } from "../../deps";

export function systemRoutes(_deps: Deps): Router {
  const r = Router();

  r.get("/version", asyncHandler(async (_req, res) => {
    res.json({
      configured: env.appLatestVersionCode > 0,
      latestVersionCode: env.appLatestVersionCode,
      apkUrl: env.appApkUrl,
      forceUpdate: env.appForceUpdate,
    });
  }));

  return r;
}
