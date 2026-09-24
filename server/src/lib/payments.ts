// Payment providers. Interface is stable; adapters are swapped per gateway.
// eSewa / Khalti adapters verify webhook signatures against env secrets —
// real sandbox merchant keys are VERIFY (founder-owned). COD always works.
//
// Webhook signature shape (documented, provider-agnostic):
//   signature = HMAC-SHA256(secret, `${transaction_id}:${amount_npr}:${status}`)
// Providers sign with their secret key; we recompute and timingSafeEqual.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Order } from "../db/types";

export type ProviderName = "esewa" | "khalti" | "cod";

export interface PaymentIntent { redirectUrl?: string; note?: string }

export interface PaymentProvider {
  readonly name: ProviderName;
  createIntent(order: Order): Promise<PaymentIntent>;
  verifyWebhook(payload: { transaction_id: string; amount_npr: number; status: string }, signature: string): boolean;
}

export function hmacSignature(secret: string, payload: { transaction_id: string; amount_npr: number; status: string }): string {
  return createHmac("sha256", secret)
    .update(`${payload.transaction_id}:${payload.amount_npr}:${payload.status}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`VERIFY: ${name} not configured — founder must supply the sandbox key`);
  return v;
}

/** VERIFY: needs ESEWA_MERCHANT_ID + ESEWA_SECRET_KEY from the founder. */
export class EsewaProvider implements PaymentProvider {
  readonly name = "esewa" as const;
  async createIntent(order: Order): Promise<PaymentIntent> {
    const merchantId = requireEnv("ESEWA_MERCHANT_ID");
    // Real flow: server-to-server initiate call to eSewa; returns payment URL.
    // Shape only until sandbox keys exist.
    throw new Error(`VERIFY: eSewa not wired (merchant ${merchantId.slice(0, 4)}…): needs sandbox credentials`);
  }
  verifyWebhook(payload: { transaction_id: string; amount_npr: number; status: string }, signature: string): boolean {
    const secret = requireEnv("ESEWA_SECRET_KEY");
    return safeEqual(hmacSignature(secret, payload), signature);
  }
}

/** VERIFY: needs KHALTI_PUBLIC_KEY + KHALTI_SECRET_KEY from the founder. */
export class KhaltiProvider implements PaymentProvider {
  readonly name = "khalti" as const;
  async createIntent(order: Order): Promise<PaymentIntent> {
    requireEnv("KHALTI_PUBLIC_KEY");
    throw new Error("VERIFY: Khalti not wired: needs sandbox credentials");
  }
  verifyWebhook(payload: { transaction_id: string; amount_npr: number; status: string }, signature: string): boolean {
    const secret = requireEnv("KHALTI_SECRET_KEY");
    return safeEqual(hmacSignature(secret, payload), signature);
  }
}

/** Cash on delivery — always works, no gateway involved. */
export class CodProvider implements PaymentProvider {
  readonly name = "cod" as const;
  async createIntent(_order: Order): Promise<PaymentIntent> {
    return { note: "Pay in cash when your kit arrives." };
  }
  verifyWebhook(): boolean { return false; } // COD has no webhooks
}

export function providerFor(name: string): PaymentProvider {
  if (name === "esewa") return new EsewaProvider();
  if (name === "khalti") return new KhaltiProvider();
  if (name === "cod") return new CodProvider();
  throw new Error(`unknown payment provider: ${name}`);
}
