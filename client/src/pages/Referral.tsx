import { useAuth } from "../auth/AuthContext";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, toast } from "../components/ui";
import { Icon } from "../components/icons";

/**
 * U4 — Referral code, derived deterministically from the user's own id.
 * No server round-trip needed; the code is shown, copyable, and shareable
 * via the native share sheet (falls back to copy when share is absent).
 */
export default function Referral() {
  const { t } = useLang();
  const { profile, profileLoading } = useAuth();

  if (profileLoading) return <Loading />;

  const userId = profile?.user_id ?? null;
  const code = userId ? `JARAA-${userId.slice(0, 6).toUpperCase()}` : null;

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast(t("p12.customer.codeCopied"));
    } catch {
      // Clipboard unavailable (older webviews): show the code so it can
      // be copied manually instead of silently failing.
      toast(`${t("p12.customer.copyCode")}: ${code}`);
    }
  }

  async function share() {
    if (!code) return;
    const text = `${t("p12.customer.referral")}: ${code}`;
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: t("p12.customer.referral"), text });
        return;
      } catch {
        // user cancelled the sheet — fall through to copy
      }
    }
    await copy();
  }

  return (
    <div className="screen">
      <h1>{t("p12.customer.referral")}</h1>
      <p className="muted tiny">{t("p12.customer.referralHint")}</p>

      {!userId && !profileLoading && <ErrorCard message={t("common.loading")} />}

      {code && (
        <div className="card center">
          <span style={{ color: "var(--green)" }}><Icon.user size={40} /></span>
          <p className="kbd" style={{ fontSize: 28, letterSpacing: 2, margin: "12px 0" }}>
            {code}
          </p>
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <button className="btn btn-p" onClick={copy}>
              {t("p12.customer.copyCode")}
            </button>
            <button className="btn btn-g" onClick={share}>
              {t("p12.customer.share")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
