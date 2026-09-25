import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useLang } from "../i18n/LanguageContext";
import { meApi } from "../api/client";
import type { Address } from "../api/types";
import { apiErrorMessage, ErrorCard, Loading, toast } from "../components/ui";
import { Icon } from "../components/icons";
import { LeaderboardOptIn, LoyaltyCard } from "../components/b3customer";
import {
  ConsentHistory,
  DataExportCard,
  FeedbackForm,
  PreferencesCard,
  ProfileCompletion,
  ReferralCard,
  SessionsCard,
  TextSizeControl,
  TourReplay,
} from "../components/b4customer";

const AGE_BANDS = ["16-22", "23-29", "30-39", "40-49", "50+"] as const;
const GENDERS = ["female", "male", "other"] as const;

const EMPTY_ADDR = { name: "", phone: "", city: "", address_line: "", label: "" };

function AddressForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: typeof EMPTY_ADDR;
  saving: boolean;
  onSave: (v: typeof EMPTY_ADDR) => void;
  onCancel: () => void;
}) {
  const { t } = useLang();
  const [v, setV] = useState(initial);
  const set = (k: keyof typeof EMPTY_ADDR) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const valid = v.name.trim() && v.phone.trim() && v.city.trim() && v.address_line.trim();
  return (
    <div className="card">
      <label className="fl">{t("profile.addrName")}</label>
      <input type="text" value={v.name} onChange={set("name")} autoComplete="name" />
      <label className="fl">{t("profile.addrPhone")}</label>
      <input type="tel" value={v.phone} onChange={set("phone")} autoComplete="tel" />
      <label className="fl">{t("profile.addrCity")}</label>
      <input type="text" value={v.city} onChange={set("city")} autoComplete="address-level2" />
      <label className="fl">{t("profile.addrLine")}</label>
      <input type="text" value={v.address_line} onChange={set("address_line")} autoComplete="street-address" />
      <label className="fl">{t("profile.addrLabel")}</label>
      <input type="text" value={v.label} onChange={set("label")} placeholder={t("profile.addrLabelPh")} />
      <div className="btn-row">
        <button className="btn btn-p" disabled={!valid || saving} onClick={() => onSave(v)}>
          {saving ? t("profile.saving") : t("common.save")}
        </button>
        <button className="btn btn-g" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

export default function Profile() {
  const { t, lang, setLang } = useLang();
  const { profile, profileLoading, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addrBusy, setAddrBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Batch-2 (008): notification prefs (U17), dark mode (U18),
  // delivery instructions (U19), emergency contacts (U20).
  const [prefs, setPrefs] = useState({ plan_updates: true, photo_requests: true, digest: false, marketing: false });
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const [delivery, setDelivery] = useState("");
  const [contacts, setContacts] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");

  // Hydrate the form once the profile loads.
  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setAgeBand(profile.age_band ?? "");
      setGender(profile.gender ?? "");
      setAddresses(profile.addresses ?? []);
      setDelivery(profile.delivery_instructions ?? "");
    }
    meApi.getNotificationPrefs().then((r) => setPrefs({
      plan_updates: r.plan_updates, photo_requests: r.photo_requests,
      digest: r.digest, marketing: r.marketing,
    })).catch(() => {});
    meApi.listEmergencyContacts().then((r) => setContacts(r.contacts)).catch(() => {});
  }, [profile?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveDetails() {
    setSaving(true);
    setError(null);
    try {
      const patch: { name?: string; age_band?: "16-22" | "23-29" | "30-39" | "40-49" | "50+"; gender?: "female" | "male" | "other"; delivery_instructions?: string } = {};
      patch.delivery_instructions = delivery;
      if (name.trim()) patch.name = name.trim();
      if (AGE_BANDS.includes(ageBand as typeof AGE_BANDS[number])) patch.age_band = ageBand as typeof patch.age_band;
      if (GENDERS.includes(gender as typeof GENDERS[number])) patch.gender = gender as typeof patch.gender;
      await meApi.updateProfile(patch);
      await refreshProfile();
      toast(t("profile.saved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  async function changeLanguage(l: "ne" | "en") {
    setLang(l);
    try {
      await meApi.updateProfile({ language: l });
      await refreshProfile();
    } catch {
      /* language is local-first; server sync is best-effort */
    }
  }

  async function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPhotoBusy(true);
    setError(null);
    try {
      await meApi.uploadProfilePhoto(f);
      await refreshProfile();
      toast(t("profile.photoSaved"));
    } catch (err) {
      setError(apiErrorMessage(t, err));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await meApi.deleteProfilePhoto();
      await refreshProfile();
      toast(t("profile.photoRemoved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function addAddr(v: typeof EMPTY_ADDR) {
    setAddrBusy(true);
    try {
      const res = await meApi.addAddress({
        name: v.name.trim(), phone: v.phone.trim(), city: v.city.trim(),
        address_line: v.address_line.trim(), label: v.label.trim() || null, is_default: false,
      });
      setAddresses((a) => [...a.map((x) => (res.address.is_default ? { ...x, is_default: false } : x)), res.address]);
      setAdding(false);
      toast(t("profile.addrSaved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setAddrBusy(false);
    }
  }

  async function editAddr(id: string, v: typeof EMPTY_ADDR) {
    setAddrBusy(true);
    try {
      const res = await meApi.updateAddress(id, {
        name: v.name.trim(), phone: v.phone.trim(), city: v.city.trim(),
        address_line: v.address_line.trim(), label: v.label.trim() || null,
      });
      setAddresses((a) => a.map((x) => (x.id === id ? res.address : x)));
      setEditingId(null);
      toast(t("profile.addrSaved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setAddrBusy(false);
    }
  }

  async function setDefault(id: string) {
    setAddrBusy(true);
    try {
      const res = await meApi.updateAddress(id, { is_default: true });
      setAddresses((a) => a.map((x) => (x.id === id ? res.address : { ...x, is_default: false })));
      toast(t("profile.addrSaved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setAddrBusy(false);
    }
  }

  async function deleteAddr(id: string) {
    if (!window.confirm(t("profile.deleteConfirm"))) return;
    setAddrBusy(true);
    try {
      await meApi.deleteAddress(id);
      const rest = addresses.filter((a) => a.id !== id);
      // Server promotes a new default when the default was deleted.
      const fresh = await meApi.listAddresses();
      setAddresses(fresh.addresses.length ? fresh.addresses : rest);
      toast(t("profile.addrDeleted"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setAddrBusy(false);
    }
  }

  async function togglePref(key: keyof typeof prefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try { await meApi.setNotificationPrefs(next); }
    catch (e) { setPrefs(prefs); setError(apiErrorMessage(t, e)); }
  }
  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("jaraa-theme", next ? "dark" : "light"); } catch { /* ignore */ }
  }
  async function addContact() {
    if (!cName.trim() || !cPhone.trim()) return;
    try {
      const r = await meApi.createEmergencyContact({ name: cName.trim(), phone: cPhone.trim() });
      setContacts((v) => [...v, r]);
      setCName(""); setCPhone("");
      toast(t("p12b.customer.saved"));
    } catch (e) { setError(apiErrorMessage(t, e)); }
  }
  async function removeContact(id: string) {
    try {
      await meApi.deleteEmergencyContact(id);
      setContacts((v) => v.filter((c) => c.id !== id));
    } catch (e) { setError(apiErrorMessage(t, e)); }
  }

  if (profileLoading && !profile) return <Loading />;

  const initial = (profile?.name ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="screen">
      <h1>{t("profile.title")}</h1>
      {error && <ErrorCard message={error} onRetry={() => setError(null)} />}

      {/* Photo + identity */}
      <div className="card">
        <div className="rowflex">
          {profile?.photo_url ? (
            <img className="avatar" src={profile.photo_url} alt={t("profile.photo")} />
          ) : (
            <div className="avatar avatar-fallback" aria-hidden="true">{initial}</div>
          )}
          <div>
            <strong>{profile?.name || t("profile.noName")}</strong>
            <div className="muted tiny">{profile?.phone}</div>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={t("profile.photo")}
          onChange={onPhotoFile}
        />
        <div className="btn-row">
          <button className="btn btn-s" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
            {photoBusy ? t("profile.photoUploading") : t("profile.changePhoto")}
          </button>
          {profile?.photo_url && (
            <button className="btn btn-g" disabled={photoBusy} onClick={removePhoto}>
              {t("profile.removePhoto")}
            </button>
          )}
        </div>
      </div>

      {/* U30: profile completion meter (batch 4) */}
      <ProfileCompletion />

      {/* U25: loyalty wallet */}
      <LoyaltyCard />

      {/* Details */}
      <div className="card">
        <h2>{t("profile.details")}</h2>
        <label className="fl">{t("profile.name")}</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("profile.namePh")} autoComplete="name" />
        <label className="fl">{t("login.ageLabel")}</label>
        <select value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
          <option value="">{t("common.na")}</option>
          {AGE_BANDS.map((b) => (
            <option key={b} value={b}>{t(`login.age.${b === "16-22" ? "a1622" : b === "23-29" ? "a2329" : b === "30-39" ? "a3039" : b === "40-49" ? "a4049" : "a50"}`)}</option>
          ))}
        </select>
        <label className="fl">{t("login.genderLabel")}</label>
        <select value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">{t("common.na")}</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>{t(`login.gender.${g}`)}</option>
          ))}
        </select>
        <label className="fl">{t("common.language")}</label>
        <div className="demo-switch" role="group" aria-label={t("common.language")}>
          {(["ne", "en"] as const).map((l) => (
            <button key={l} className={lang === l ? "sel" : ""} onClick={() => changeLanguage(l)}>
              {l === "ne" ? "नेपाली" : "English"}
            </button>
          ))}
        </div>
        <label className="fl" htmlFor="deliv">{t("p12b.customer.delivery")}</label>
        <textarea
          id="deliv" value={delivery} onChange={(e) => setDelivery(e.target.value)}
          placeholder={t("p12b.customer.deliveryPh")} rows={2} maxLength={500}
        />
        <button className="btn btn-p" disabled={saving} onClick={saveDetails}>
          {saving ? t("profile.saving") : t("common.save")}
        </button>
      </div>

      {/* U30/U46: content-language + default payment (batch 4) */}
      <PreferencesCard />

      {/* U32: referrals (batch 4) */}
      <ReferralCard />

      {/* Addresses */}
      <div className="card">
        <h2>{t("profile.addresses")}</h2>
        {addresses.length === 0 && !adding && <p className="muted">{t("profile.noAddresses")}</p>}
        {addresses.map((a) => (
          <div key={a.id} className="addr-card">
            {editingId === a.id ? (
              <AddressForm
                initial={{ name: a.name, phone: a.phone, city: a.city, address_line: a.address_line, label: a.label ?? "" }}
                saving={addrBusy}
                onSave={(v) => editAddr(a.id, v)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <div className="rowflex">
                  <strong>{a.label || a.name}</strong>
                  {a.is_default && <span className="chip">{t("profile.defaultAddr")}</span>}
                  <span className="spacer" />
                  <button className="iconbtn" onClick={() => setEditingId(a.id)} aria-label={t("profile.editAddress")}>
                    <Icon.doc size={18} />
                  </button>
                </div>
                <div className="muted tiny">{a.name} · {a.phone}</div>
                <div className="muted tiny">{a.address_line}, {a.city}</div>
                <div className="btn-row">
                  {!a.is_default && (
                    <button className="btn btn-g" disabled={addrBusy} onClick={() => setDefault(a.id)}>
                      {t("profile.setDefault")}
                    </button>
                  )}
                  <button className="btn btn-g" disabled={addrBusy} onClick={() => deleteAddr(a.id)}>
                    {t("profile.deleteAddr")}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {adding ? (
          <AddressForm initial={EMPTY_ADDR} saving={addrBusy} onSave={addAddr} onCancel={() => setAdding(false)} />
        ) : (
          <button className="btn btn-s" onClick={() => { setEditingId(null); setAdding(true); }}>
            {t("profile.addAddress")}
          </button>
        )}
      </div>

      {/* U37: app feedback (batch 4) */}
      <FeedbackForm />

      {/* U36: consent history (batch 4) */}
      <ConsentHistory />

      {/* U45: signed-in sessions (batch 4) */}
      <SessionsCard />

      {/* U44: data export incl. photo link (batch 4) */}
      <DataExportCard />

      {/* U47: text size (batch 4) */}
      <TextSizeControl />

      {/* U38: app tour (batch 4) */}
      <div className="card">
        <h2>{t("p12d.customer.tourTitle")}</h2>
        <TourReplay />
      </div>

      {/* U17: notification preferences */}
      <div className="card">
        <h2>{t("p12b.customer.notifs")}</h2>
        {(["plan_updates", "photo_requests", "digest", "marketing"] as const).map((k) => (
          <label className="rowflex" key={k} style={{ margin: "8px 0" }}>
            <input
              type="checkbox" checked={prefs[k]} onChange={() => togglePref(k)}
              style={{ width: 28, height: 28, minHeight: 28 }}
            />
            <span>{t(`p12b.customer.pref.${k}`)}</span>
          </label>
        ))}
        {/* C19: streak-board leaderboard opt-in */}
        <h2>{t("p12c.customer.leaderboard.title")}</h2>
        <LeaderboardOptIn />
      </div>

      {/* U18: dark mode */}
      <div className="card">
        <h2>{t("p12b.customer.appearance")}</h2>
        <label className="rowflex" style={{ margin: "8px 0" }}>
          <input
            type="checkbox" checked={dark} onChange={toggleDark}
            style={{ width: 28, height: 28, minHeight: 28 }}
          />
          <span>{t("p12b.customer.darkMode")}</span>
        </label>
      </div>

      {/* U20: emergency contacts */}
      <div className="card">
        <h2>{t("p12b.customer.emergency")}</h2>
        <div className="formrow inline">
          <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder={t("p12b.customer.contactNamePh")} maxLength={120} />
          <input value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder={t("p12b.customer.phonePh")} maxLength={40} />
          <button className="btn" disabled={!cName.trim() || !cPhone.trim()} onClick={addContact}>{t("common.add")}</button>
        </div>
        {contacts.map((c) => (
          <div className="rowflex" key={c.id} style={{ margin: "8px 0" }}>
            <div><strong>{c.name}</strong> <span className="muted tiny">{c.phone}</span></div>
            <span className="spacer" />
            <button className="btn btn-g btn-s" onClick={() => removeContact(c.id)}>{t("common.delete")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
