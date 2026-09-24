// Password-flow email templates, defined INLINE in the auth module.
// lib/brevo.ts is owned by another worker — call sendEmail()/welcomeEmail()
// from there, but define these templates here.
const shell = (title: string, body: string) => `<!doctype html><html><body style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
<h2>${title}</h2>${body}<hr><p style="color:#666;font-size:12px">Jaraa (जरा) — root care, lasting hair.</p></body></html>`;

export const passwordResetEmail = (resetUrl: string) => ({
  subject: "Reset your Jaraa password 🔑",
  html: shell(
    "Reset your password",
    `<p>Namaste,</p><p>Someone asked to reset the password for this Jaraa account. If that was you, set a new password here — the link works for <b>1 hour</b> and can be used only once:</p>` +
      `<p><a href="${resetUrl}" style="display:inline-block;background:#1a5c3f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Set a new password</a></p>` +
      `<p style="color:#666;font-size:13px">If the button doesn't work, copy this link into your browser:<br>${resetUrl}</p>` +
      `<p style="color:#666;font-size:13px">Didn't ask for this? Ignore this email — your password stays as it is.</p>`,
  ),
});

export const passwordChangedEmail = () => ({
  subject: "Your Jaraa password was changed ✅",
  html: shell(
    "Password changed",
    `<p>Namaste,</p><p>Your Jaraa account password was just changed. If this was you, nothing more to do.</p><p style="color:#666;font-size:13px">If you did <b>not</b> change it, reply to this email right away so we can secure your account.</p>`,
  ),
});
