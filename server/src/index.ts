// Boot: env -> store -> deps -> express -> listen.
import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app";
import { env } from "./env";
import { MemoryStore } from "./db/memory";
import { SupabaseStore } from "./db/supabase";
import { OtpService } from "./lib/otp";
import { buildSmsProvider } from "./lib/sms";
import { memoryStorage, supabaseStorage, profilePhotosStorage, memoryPublicStorage, supabasePublicStorage } from "./lib/photos";
import { ChunkAssembler } from "./lib/chunks";
import { hashPassword } from "./lib/jwt";
import type { Deps } from "./deps";

// minimal .env loader (Render injects real env vars; this is for local dev)
function loadDotEnv() {
  const p = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

// scan_rules seed mirror (001_init.sql) — applied only when the table is empty
const RULE_SEEDS = [
  { priority: 100, trigger_condition: { pin: "childbirth", within_months: 12 }, action: "activate_path", action_params: { path: "postpartum" }, copy_ne: "बधाई छ! प्रसवपछि कपाल झर्नु सामान्य हो।", copy_en: "Postpartum shedding is normal — here is your 12-month watch plan.", is_active: true },
  { priority: 90, trigger_condition: { any_red_flag: true }, action: "raise_flag", action_params: { block_plan: true }, copy_ne: "डाक्टरले हेर्नुपर्ने संकेत देखियो।", copy_en: "We spotted something a doctor should look at first.", is_active: true },
  { priority: 80, trigger_condition: { pin: "medication_change", still_taking: true }, action: "raise_flag", action_params: { flag: "RF6", block_plan: true }, copy_ne: "औषधिसम्बन्धी जाँच आवश्यक छ।", copy_en: "A medication check is needed before we continue.", is_active: true },
  { priority: 70, trigger_condition: { age_band: "16-22", gender: "male" }, action: "prune", action_params: { prune: ["hormones"], boost: ["damage", "scalp"] }, copy_ne: null, copy_en: null, is_active: true },
  { priority: 60, trigger_condition: { pin: "stress_period", sleep_hours_lt: 6 }, action: "activate_path", action_params: { path: "stress" }, copy_ne: "निन्द्रा सुधारमा ध्यान दिऔं।", copy_en: "Let us focus on improving your sleep.", is_active: true },
  { priority: 50, trigger_condition: { only_pin: "shedding_onset" }, action: "extra_questions", action_params: { per_root: 3 }, copy_ne: null, copy_en: null, is_active: true },
  { priority: 10, trigger_condition: {}, action: "standard_path", action_params: {}, copy_ne: null, copy_en: null, is_active: true },
];

async function main() {
  const sms = buildSmsProvider();
  let store: MemoryStore | SupabaseStore;
  let storage: ReturnType<typeof memoryStorage> | ReturnType<typeof supabaseStorage>;
  let profileStorage: ReturnType<typeof memoryStorage> | ReturnType<typeof profilePhotosStorage>;
  let kitStorage: ReturnType<typeof memoryPublicStorage> | ReturnType<typeof supabasePublicStorage>;

  if (env.hasSupabase) {
    const sb = new SupabaseStore(env.supabaseUrl, env.supabaseServiceKey);
    await sb.ensureSeededFlags();
    await sb.seedScanRules(RULE_SEEDS);
    store = sb;
    storage = supabaseStorage({ storage: sb.storage() });
    profileStorage = profilePhotosStorage({ storage: sb.storage() });
    kitStorage = supabasePublicStorage({ storage: sb.storage() }, "kit-images");
    console.log("[boot] using Supabase store");
  } else {
    console.warn("[boot] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — in-memory store (dev/test only)");
    store = new MemoryStore();
    storage = memoryStorage();
    profileStorage = memoryStorage();
    kitStorage = memoryPublicStorage();
  }

  const deps: Deps = {
    store,
    otp: new OtpService(sms, store, env.otpHmacSecret, Date.now, env.otpDevMode),
    sms,
    storage,
    profileStorage,
    kitStorage,
    chunks: new ChunkAssembler(),
    jwtSecret: env.jwtSecret,
    secureCookies: (process.env.COOKIE_SECURE ?? "true").toLowerCase() === "true",
  };

  // admin bootstrap (first boot only)
  if (env.adminEmail && env.adminPassword) {
    const existing = await store.getUserByEmail(env.adminEmail);
    if (!existing) {
      await store.createUser({
        phone: "+9779800000000", // placeholder — admin signs in with email+password
        email: env.adminEmail,
        role: "admin",
        passwordHash: await hashPassword(env.adminPassword),
      });
      console.log(`[boot] admin user created (${env.adminEmail})`);
    }
  }

  const app = buildApp(deps, { version: env.appVersion });
  app.listen(env.port, () => {
    console.log(`[boot] jaraa api listening on :${env.port} (v${env.appVersion})`);
  });
}

main().catch((e) => {
  console.error("[boot] fatal:", e);
  process.exit(1);
});
