import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useLang } from "../../i18n/LanguageContext";
import { meApi } from "../../api/client";
import type { Role } from "../../api/types";
import { apiErrorMessage, ErrorCard, Loading, NoticeBox, toast } from "../../components/ui";
import { Icon } from "../../components/icons";

const AGE_BANDS = ["16-22", "23-29", "30-39", "40-49", "50+"] as const;
const GENDERS = ["female", "male", "other"] as const;

/** Role-relevant work fields. No server endpoint exists for these in v1,
 *  so they are stored on this device only — the UI says exactly that. */
const EXTRA_FIELDS: Record<Exclude<Role, "customer">, Array<{ key: string; labelKey: string; phKey: string }>> = {
  doctor: [
    { key: "nmc", labelKey: "staffProfile.nmc", phKey: "staffProfile.nmcPh" },
    { key: "specialty", labelKey: "staffProfile.specialty", phKey: "staffProfile.specialtyPh" },
  ],
  pharmacy: [
    { key: "license", labelKey: "staffProfile.license", phKey: "staffProfile.licensePh" },
    { key: "hours", labelKey: "staffProfile.hours", phKey: "staffProfile.hoursPh" },
  ],
  coach: [{ key: "focus", labelKey: "staffProfile.focus", phKey: "staffProfile.focusPh" }],
  admin: [],
};

function useDeviceExtras(role: Exclude<Role, "customer">) {
  const key = `jaraa:staff-extras:${role}`;
  const [extras, setExtras] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const save = (patch: Record<string, string>) => {
    const next = { ...extras, ...patch };
    setExtras(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* device-only, best effort */
    }
  };
  return { extras, save, storageKey: key };
}

/**
 * Staff profile: photo upload + name/details editing (same endpoints as
 * the customer profile), a role card, and role-relevant work fields.
 * Customers keep the full Profile page with addresses; staff don't need them.
 */
export default function StaffProfile() {
  const { t, lang, setLang } = useLang();
  const { profile, profileLoading, refreshProfile, role, logout } = useAuth();
  const staffRole = (role ?? "admin") as Exclude<Role, "customer">;
  const [name, setName] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extrasDraft, setExtrasDraft] = useState<Record<string, string>>({});
  const { extras, save } = useDeviceExtras(staffRole);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setAgeBand(profile.age_band ?? "");
      setGender(profile.gender ?? "");
    }
  }, [profile?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setExtrasDraft(extras);
  }, [extras]);

  async function saveDetails() {
    setSaving(true);
    setError(null);
    try {
      const patch: { name?: string; age_band?: "16-22" | "23-29" | "30-39" | "40-49" | "50+"; gender?: "female" | "male" | "other" } = {};
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

  function saveExtras() {
    save(extrasDraft);
    toast(t("profile.saved"));
  }

  if (profileLoading && !profile) return <Loading />;

  const initial = (profile?.name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const fields = EXTRA_FIELDS[staffRole];

  return (
    <div className="screen">
      <h1>{t("staffProfile.title")}</h1>
      {error && <ErrorCard message={error} onRetry={() => setError(null)} />}

      {/* Role card */}
      <div className="card rowflex">
        <span style={{ color: "var(--green)" }}><Icon.doc size={26} /></span>
        <div>
          <b>{t(`roles.${staffRole}`)}</b>
          <br />
          <span className="muted tiny">{profile?.phone}{profile?.email ? ` · ${profile.email}` : ""}</span>
        </div>
        <span className="spacer" />
        <button className="btn btn-g" onClick={logout}>
          <Icon.logout size={18} /> {t("common.signOut")}
        </button>
      </div>

      {/* Photo + identity (same endpoints as the customer profile) */}
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
        <button className="btn btn-p" disabled={saving} onClick={saveDetails}>
          {saving ? t("profile.saving") : t("common.save")}
        </button>
      </div>

      {/* Role-relevant work fields (device-only until the server supports them) */}
      {fields.length > 0 && (
        <div className="card">
          <h2>{t("staffProfile.workInfo")}</h2>
          <NoticeBox tone="notice" title="">
            <p className="tiny">{t("staffProfile.deviceNote")}</p>
          </NoticeBox>
          {fields.map((f) => (
            <div key={f.key}>
              <label className="fl">{t(f.labelKey)}</label>
              <input
                type="text"
                value={extrasDraft[f.key] ?? ""}
                onChange={(e) => setExtrasDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                placeholder={t(f.phKey)}
              />
            </div>
          ))}
          <button className="btn btn-s" onClick={saveExtras}>
            {t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
}
