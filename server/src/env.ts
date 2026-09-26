// Central env access. Every secret comes from process.env — nothing hard-coded.
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env: ${name}`);
  return v;
}
function opt(name: string, dflt = ""): string {
  return process.env[name] ?? dflt;
}

export const env = {
  port: parseInt(opt("PORT", "3000"), 10),
  appVersion: opt("APP_VERSION", "0.1.0"),
  get jwtSecret() { return req("JWT_SECRET"); },
  get otpHmacSecret() { return req("OTP_HMAC_SECRET"); },
  otpDevMode: opt("OTP_DEV_MODE", "false").toLowerCase() === "true",
  supabaseUrl: opt("SUPABASE_URL"),
  supabaseServiceKey: opt("SUPABASE_SERVICE_ROLE_KEY"),
  adminEmail: opt("ADMIN_EMAIL"),
  adminPassword: opt("ADMIN_PASSWORD"),
  brevoApiKey: opt("BREVO_API_KEY"),
  brevoSenderEmail: opt("BREVO_SENDER_EMAIL"),
  smsProvider: opt("SMS_PROVIDER", "log"),
  smsApiKey: opt("SMS_API_KEY"),
  smsSenderId: opt("SMS_SENDER_ID"),
  geminiApiKey: opt("GEMINI_API_KEY"),
  esewaMerchantId: opt("ESEWA_MERCHANT_ID"),
  esewaSecretKey: opt("ESEWA_SECRET_KEY"),
  khaltiPublicKey: opt("KHALTI_PUBLIC_KEY"),
  khaltiSecretKey: opt("KHALTI_SECRET_KEY"),
  publicBaseUrl: opt("PUBLIC_BASE_URL", "http://localhost:3000"),
  // v1.3.0 forced-update check (P-4): served by GET /api/v1/app/version.
  // Rabindra-owned: host the JSON + APK and set these. Until set, the
  // endpoint honestly reports configured:false and apps must not nag.
  appLatestVersionCode: parseInt(opt("APP_LATEST_VERSION_CODE", "0"), 10),
  appApkUrl: opt("APP_APK_URL"),
  appForceUpdate: opt("APP_FORCE_UPDATE", "false").toLowerCase() === "true",
  get hasSupabase() { return !!(this.supabaseUrl && this.supabaseServiceKey); },
};
