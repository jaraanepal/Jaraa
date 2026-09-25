// Brevo HTTPS email ONLY. There are intentionally NO SMTP code paths in this
// codebase (Render blocks outbound ports 25/465/587).
// Used for: plan-approved notification, order confirmation, welcome email.
export interface EmailResult { messageId?: string; skipped?: boolean }

/**
 * A37: email delivery log hook. The app wires a store logger here
 * (server/src/app.ts -> setEmailLogger) so every Brevo send — including
 * skipped (unconfigured) and failed sends — lands in email_logs.
 * Logging never throws and never breaks the send path.
 */
export interface EmailLogEvent {
  to_email: string; template: string; status: "sent" | "failed"; error?: string | null;
}
let emailLogger: ((e: EmailLogEvent) => void) | null = null;
export function setEmailLogger(fn: ((e: EmailLogEvent) => void) | null): void {
  emailLogger = fn;
}
function logEmailResult(e: EmailLogEvent): void {
  try {
    emailLogger?.(e);
  } catch (err) {
    console.error("[brevo] email log hook failed:", err);
  }
}

export async function sendEmail(to: string, subject: string, html: string, opts?: { template?: string }): Promise<EmailResult> {
  const template = opts?.template ?? "unknown";
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !sender) {
    console.warn("[brevo] BREVO_API_KEY/BREVO_SENDER_EMAIL not set — email skipped");
    logEmailResult({ to_email: to, template, status: "failed", error: "BREVO_API_KEY/BREVO_SENDER_EMAIL not set — email skipped" });
    return { skipped: true };
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: sender, name: "Jaraa" },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = `brevo api error ${res.status}: ${body.slice(0, 200)}`;
      logEmailResult({ to_email: to, template, status: "failed", error: err });
      throw new Error(err);
    }
    const json = (await res.json().catch(() => ({}))) as { messageId?: string };
    logEmailResult({ to_email: to, template, status: "sent" });
    return { messageId: json.messageId };
  } catch (e) {
    // Network-level failure (fetch threw before we could log) — log it once.
    if (e instanceof Error && !e.message.startsWith("brevo api error")) {
      logEmailResult({ to_email: to, template, status: "failed", error: e.message.slice(0, 300) });
    }
    throw e;
  }
}

const shell = (title: string, body: string) => `<!doctype html><html><body style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
<h2>${title}</h2>${body}<hr><p style="color:#666;font-size:12px">Jaraa (जरा) — root care, lasting hair.</p></body></html>`;

export const welcomeEmail = (name?: string | null) => ({
  subject: "Welcome to Jaraa 🌱",
  html: shell("Welcome to Jaraa", `<p>Namaste${name ? ` ${name}` : ""},</p><p>Your Jaraa account is ready. Start your Root Scan any time — your dermatologist reviews every scan personally.</p><p><i>Jaraa organizes the evidence; your dermatologist makes the decisions.</i></p>`),
});

export const planApprovedEmail = (name?: string | null) => ({
  subject: "Your Jaraa plan is ready ✅",
  html: shell("Your dermatologist reviewed your scan", `<p>Namaste${name ? ` ${name}` : ""},</p><p>Good news — your dermatologist has approved your personalised hair-care plan. Open the Jaraa app to see it.</p>`),
});

export const orderConfirmationEmail = (orderNo: string, totalNpr: number) => ({
  subject: `Jaraa order ${orderNo} confirmed 🧾`,
  html: shell("Order confirmed", `<p>Thank you! Your order <b>${orderNo}</b> for <b>NPR ${totalNpr}</b> is confirmed. We will notify you when it ships.</p>`),
});

export const scanSubmittedEmail = (name?: string | null) => ({
  subject: "Your Jaraa scan is with a dermatologist 🔍",
  html: shell("Scan submitted", `<p>Namaste${name ? ` ${name}` : ""},</p><p>Your Root Scan has been submitted and is now in the dermatologist review queue. We will email you as soon as your personalised plan is ready.</p>`),
});

export const orderShippedEmail = (orderNo: string) => ({
  subject: `Jaraa order ${orderNo} has shipped 📦`,
  html: shell("Order shipped", `<p>Good news — your order <b>${orderNo}</b> is on its way. Track it in the Jaraa app under Kits → My orders.</p>`),
});

export const emailOtpEmail = (code: string) => ({
  subject: `Jaraa: your code is ${code}`,
  html: shell("Your Jaraa sign-in code", `<p>Your one-time sign-in code is:</p><p style="font-size:28px;letter-spacing:6px"><b>${code}</b></p><p>It expires in 5 minutes. Never share this code with anyone — Jaraa staff will never ask for it.</p>`),
});
