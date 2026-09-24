// SMS provider adapter — ported from spikes/otp/src/providers.ts.
// The rest of the system depends on this interface; only the adapter changes
// when the gateway does. No credentials are hard-coded.
export interface SmsProvider {
  readonly name: string;
  sendSms(toE164: string, message: string): Promise<{ providerRef: string }>;
}

/** Dev/test adapter: logs to console. Never used in production. */
export class LogSmsProvider implements SmsProvider {
  readonly name = "log";
  async sendSms(toE164: string, message: string) {
    console.log(`[sms:log] to=${toE164} msg=${message}`);
    return { providerRef: `log-${Date.now()}` };
  }
}

/**
 * VERIFY — real Nepal gateway adapter (shape only; no account exists yet).
 * Founder must pick a gateway and supply SMS_API_KEY + SMS_SENDER_ID, then
 * implement sendSms with a signed HTTPS call, retry with backoff, and
 * delivery-receipt webhook logging.
 */
export class NepalSmsProvider implements SmsProvider {
  readonly name = "nepal-gateway";
  constructor(private apiKey: string, private senderId: string) {
    if (!apiKey || !senderId) throw new Error("VERIFY: gateway credentials not configured");
  }
  async sendSms(_toE164: string, _message: string): Promise<{ providerRef: string }> {
    throw new Error("VERIFY: no live gateway wired — needs founder's SMS account");
  }
}

export function buildSmsProvider(): SmsProvider {
  if (process.env.SMS_PROVIDER === "nepal") {
    return new NepalSmsProvider(process.env.SMS_API_KEY ?? "", process.env.SMS_SENDER_ID ?? "");
  }
  return new LogSmsProvider();
}
