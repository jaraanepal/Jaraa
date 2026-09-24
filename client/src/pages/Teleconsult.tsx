import { useState } from "react";
import { useFlags } from "../auth/FlagsContext";
import { useLang } from "../i18n/LanguageContext";
import { consultsApi } from "../api/client";
import { ErrorCard, NoticeBox, apiErrorMessage } from "../components/ui";
import { Icon } from "../components/icons";

/**
 * Teleconsult page. The booking UI is fully built, but while the
 * `teleconsult_booking` feature flag is OFF (pre-legal), customers see the
 * disabled state — booking only activates after the medical/legal gates.
 */
export default function Teleconsult() {
  const { t } = useLang();
  const flags = useFlags();
  const [slot, setSlot] = useState("morning");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  if (!flags.teleconsult_booking) {
    return (
      <div className="screen">
        <h1>{t("teleconsult.title")}</h1>
        <NoticeBox tone="notice" title={t("teleconsult.disabledTitle")}>
          <div className="rowflex">
            <span style={{ color: "var(--gold)" }}><Icon.lock size={28} /></span>
            <p style={{ margin: 0 }}>{t("teleconsult.disabledBody")}</p>
          </div>
          <p className="tiny muted">{t("teleconsult.disabledLegal")}</p>
        </NoticeBox>
      </div>
    );
  }

  async function book() {
    setBusy(true);
    setError(null);
    try {
      // VERIFY: no doctor-directory endpoint in the v1 contract — the backend
      // assigns the dermatologist when the legal phase completes.
      const at = new Date();
      at.setDate(at.getDate() + 1);
      at.setHours(slot === "morning" ? 10 : 18, 0, 0, 0);
      await consultsApi.book("assigned", at.toISOString());
      setBooked(true);
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1>{t("teleconsult.title")}</h1>
      {error && <ErrorCard message={error} />}
      {booked ? (
        <div className="card center">
          <div style={{ color: "var(--green)" }}><Icon.check size={44} /></div>
          <p><b>{t("teleconsult.booked")}</b></p>
        </div>
      ) : (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("teleconsult.bookingTitle")}</h3>
          <p className="muted">{t("teleconsult.bookingSub")}</p>
          <label className="fl" htmlFor="slot">{t("teleconsult.bookingTitle")}</label>
          <select id="slot" value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="morning">{t("teleconsult.slotMorning")}</option>
            <option value="evening">{t("teleconsult.slotEvening")}</option>
          </select>
          <button className="btn btn-p" disabled={busy} onClick={book}>
            {busy ? t("common.loading") : t("teleconsult.book")}
          </button>
        </div>
      )}
    </div>
  );
}
