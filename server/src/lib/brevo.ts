// Brevo HTTPS email ONLY. There are intentionally NO SMTP code paths in this
// codebase (Render blocks outbound ports 25/465/587).
// Used for: plan-approved notification, order confirmation, welcome email.
export interface EmailResult { messageId?: string; skipped?: boolean }

export async function sendEmail(to: string, subject: string, html: string): Promise<EmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !sender) {
    console.warn("[brevo] BREVO_API_KEY/BREVO_SENDER_EMAIL not set — email skipped");
    return { skipped: true };
  }
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
    throw new Error(`brevo api error ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { messageId?: string };
  return { messageId: json.messageId };
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
