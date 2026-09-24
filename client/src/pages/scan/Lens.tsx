import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useScan } from "./ScanShell";
import { useLang } from "../../i18n/LanguageContext";
import { useAuth } from "../../auth/AuthContext";
import { Chip, ErrorCard, apiErrorMessage, toast } from "../../components/ui";
import { Icon } from "../../components/icons";
import { authApi, meApi, scansApi } from "../../api/client";
import { NEPAL_MOBILE } from "../../lib/password";
import type { PhotoAngle } from "../../api/types";

const ANGLES: PhotoAngle[] = ["hairline", "crown", "parting", "temples", "shedding"];
const CONSENT_VERSION = "photo-v3";
const DARK_THRESHOLD = 48; // mean luminance 0–255 below which the shutter locks

/** Dashed SVG overlay guide per angle, drawn over the live camera view. */
function GuideSVG({ angle }: { angle: PhotoAngle }) {
  const dash = { stroke: "#9fe0b8", strokeWidth: 2, strokeDasharray: "6 4", fill: "none" };
  let inner: React.ReactNode = null;
  if (angle === "hairline")
    inner = (<><ellipse cx="42" cy="44" rx="26" ry="30" {...dash} /><path d="M18 34 Q42 22 66 34" stroke="#ffd97a" strokeWidth="2.5" fill="none" /></>);
  else if (angle === "crown")
    inner = (<><circle cx="42" cy="42" r="28" {...dash} /><circle cx="42" cy="42" r="10" stroke="#ffd97a" strokeWidth="2.5" fill="none" /></>);
  else if (angle === "parting")
    inner = (<><ellipse cx="42" cy="44" rx="26" ry="30" {...dash} /><line x1="42" y1="16" x2="42" y2="70" stroke="#ffd97a" strokeWidth="2.5" /></>);
  else if (angle === "temples")
    inner = (<><path d="M30 12 Q58 20 54 46 Q50 66 30 70" {...dash} /><circle cx="56" cy="40" r="9" stroke="#ffd97a" strokeWidth="2.5" fill="none" /></>);
  else
    inner = (<><circle cx="38" cy="38" r="24" stroke="#ffd97a" strokeWidth="2.5" fill="none" /><line x1="56" y1="56" x2="72" y2="72" stroke="#ffd97a" strokeWidth="5" strokeLinecap="round" /></>);
  return (
    <svg className="svgguide" viewBox="0 0 84 84" aria-hidden="true">{inner}</svg>
  );
}

function GuideOverlay({ angle }: { angle: PhotoAngle }) {
  // Large centered overlay drawn over the video element.
  return (
    <svg viewBox="0 0 84 84" className="overlay" aria-hidden="true" style={{ width: "100%", height: "100%" }}>
      <ellipse cx="42" cy="44" rx="30" ry="34" stroke="#9fe0b8" strokeWidth="1.6" strokeDasharray="7 5" fill="none" opacity="0.95" />
      {angle === "hairline" && <path d="M16 36 Q42 22 68 36" stroke="#ffd97a" strokeWidth="2" fill="none" />}
      {angle === "crown" && <circle cx="42" cy="42" r="10" stroke="#ffd97a" strokeWidth="2" fill="none" />}
      {angle === "parting" && <line x1="42" y1="14" x2="42" y2="72" stroke="#ffd97a" strokeWidth="2" />}
      {angle === "temples" && <circle cx="58" cy="40" r="9" stroke="#ffd97a" strokeWidth="2" fill="none" />}
      {angle === "shedding" && <circle cx="42" cy="42" r="16" stroke="#ffd97a" strokeWidth="2" fill="none" />}
    </svg>
  );
}

/**
 * Re-encode through a canvas: strips EXIF (privacy) and compresses.
 * The server strips EXIF again; this is the client-side layer.
 */
export async function stripExifAndCompress(source: Blob | HTMLVideoElement, maxDim = 1280): Promise<Blob> {
  const img = source instanceof HTMLVideoElement ? null : await createImageBitmap(source);
  const vw = source instanceof HTMLVideoElement ? source.videoWidth : img!.width;
  const vh = source instanceof HTMLVideoElement ? source.videoHeight : img!.height;
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  if (source instanceof HTMLVideoElement) ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  else ctx.drawImage(img!, 0, 0, canvas.width, canvas.height);
  img?.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  if (!blob) throw new Error("encode failed");
  return blob;
}

function meanLuminance(video: HTMLVideoElement): number {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx || video.videoWidth === 0) return 255;
  ctx.drawImage(video, 0, 0, 48, 48);
  const d = ctx.getImageData(0, 0, 48, 48).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return sum / (d.length / 4);
}

export default function Lens() {
  const { t } = useLang();
  const { isAuthed, isGuest } = useAuth();
  const { scanId, draft, updateDraft, goStage, detail, reload } = useScan();
  const navigate = useNavigate();

  const [consentBusy, setConsentBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [camAngle, setCamAngle] = useState<PhotoAngle | null>(null);
  const [camError, setCamError] = useState(false);
  const [brightness, setBrightness] = useState(255);
  const [uploading, setUploading] = useState<PhotoAngle | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  const doneCount = ANGLES.filter((a) => draft.uploadedAngles[a] || previews[a]).length;

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setCamAngle(null);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera(angle: PhotoAngle) {
    setCamError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamAngle(angle);
    } catch {
      // Camera missing / permission denied -> file-upload fallback (flow doc).
      setCamError(true);
    }
  }

  // Attach stream + run the lighting meter.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !camAngle || !streamRef.current) return;
    video.srcObject = streamRef.current;
    video.play().catch(() => {});
    const loop = () => {
      if (videoRef.current) setBrightness(meanLuminance(videoRef.current));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [camAngle]);

  async function giveConsent() {
    setConsentBusy(true);
    setError(null);
    try {
      const c = await meApi.recordConsent("photo", CONSENT_VERSION, true);
      updateDraft({ consentPhoto: true, consentId: c.id });
    } catch (e) {
      // 409 = identical consent already recorded -> treat as granted.
      if ((e as { code?: string })?.code === "conflict") {
        updateDraft({ consentPhoto: true });
      } else {
        setError(apiErrorMessage(t, e));
      }
    } finally {
      setConsentBusy(false);
    }
  }

  async function uploadBlob(angle: PhotoAngle, blob: Blob) {
    if (!draft.consentPhoto) {
      toast(t("lens.needConsentFirst"));
      return;
    }
    setUploading(angle);
    setError(null);
    try {
      // consentId may be absent when the consent was recorded in an earlier
      // session (409 replay guard); the server re-validates the consent row.
      const photo = await scansApi.uploadPhoto(scanId, angle, blob, draft.consentId ?? undefined);
      updateDraft({ uploadedAngles: { ...draft.uploadedAngles, [angle]: photo.id } });
      await reload();
      toast(t("lens.photoSaved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setUploading(null);
    }
  }

  async function captureFromCamera() {
    const video = videoRef.current;
    if (!video || !camAngle || brightness < DARK_THRESHOLD) return;
    try {
      const blob = await stripExifAndCompress(video);
      const url = URL.createObjectURL(blob);
      setPreviews((p) => ({ ...p, [camAngle]: url }));
      stopCamera();
      await uploadBlob(camAngle, blob);
    } catch {
      setError(t("errors.unknown"));
    }
  }

  async function onFile(angle: PhotoAngle, file: File | undefined) {
    if (!file) return;
    try {
      const blob = await stripExifAndCompress(file);
      const url = URL.createObjectURL(blob);
      setPreviews((p) => ({ ...p, [angle]: url }));
      await uploadBlob(angle, blob);
    } catch {
      setError(t("errors.unknown"));
    }
  }

  async function retake(angle: PhotoAngle) {
    const photoId = draft.uploadedAngles[angle];
    if (photoId) {
      try {
        await scansApi.deletePhoto(scanId, photoId);
      } catch {
        /* best effort */
      }
    }
    const next = { ...draft.uploadedAngles };
    delete next[angle];
    updateDraft({ uploadedAngles: next });
    setPreviews((p) => {
      const n = { ...p };
      if (n[angle]) URL.revokeObjectURL(n[angle]);
      delete n[angle];
      return n;
    });
    await reload();
  }

  // Guest soft-gate: Lens requires login (flow doc entry rule).
  // Guest mode is fine until Stage 2 — here a guest hits the verification
  // wall: phone OTP converts the guest into a real account and claims the
  // guest scan (claim_guest_scan_id). Non-guest visitors get the sign-in page.
  if (!isAuthed) {
    return isGuest ? (
      <GuestVerifyWall />
    ) : (
      <div>
        <h1>{t("lens.title")}</h1>
        <div className="card center">
          <div style={{ color: "var(--green)" }}><Icon.lock size={44} /></div>
          <h3>{t("lens.guestTitle")}</h3>
          <p className="muted">{t("lens.guestBody")}</p>
          <p className="tiny muted">{t("errors.guest_forbidden")}</p>
          <button
            className="btn btn-p"
            onClick={() => navigate(`/login?returnTo=${encodeURIComponent(`/scan/${scanId}`)}`)}
          >
            {t("common.signIn")}
          </button>
        </div>
      </div>
    );
  }

  const dark = brightness < DARK_THRESHOLD;

  return (
    <div>
      <h1>{t("lens.title")}</h1>
      <p className="muted">{t("lens.subtitle")} <b>{doneCount}/5</b></p>
      {error && <ErrorCard message={error} />}

      {!draft.consentPhoto && (
        <div className="card" style={{ border: "2px solid var(--green)" }}>
          <h3>{t("lens.consentTitle")}</h3>
          <p>{t("lens.consentBody")}</p>
          <ConsentCheckbox
            label={t("lens.consentCheckbox")}
            onAgree={giveConsent}
            busy={consentBusy}
            tickFirst={t("lens.consentTickFirst")}
            agreeLabel={t("lens.consentAgree")}
          />
        </div>
      )}

      {ANGLES.map((angle, i) => {
        const photoId = draft.uploadedAngles[angle];
        const serverPhoto = detail?.photos.find((p) => p.angle === angle);
        const preview = previews[angle] ?? serverPhoto?.thumb_url;
        const isCam = camAngle === angle;
        return (
          <div className="angle" key={angle}>
            <div className="ah">
              <GuideSVG angle={angle} />
              <div>
                <b>{i + 1}. {t(`lens.angles.${angle}`)}</b>
                <br />
                {preview || photoId ? <Chip>{t("lens.captured")}</Chip> : <Chip tone="grey">{t("lens.pending")}</Chip>}
              </div>
            </div>

            {preview && !isCam && (
              <>
                <img className="prev" src={preview} alt={t(`lens.angles.${angle}`)} />
                <div className="card" style={{ margin: "10px 0", padding: "10px 12px" }}>
                  <small className="muted">
                    {t("lens.estimateLabel")} — <b>{t("lens.estimateNote")}</b>
                  </small>
                  <div className="scorebar">
                    <i style={{ width: `${Math.round((brightness / 255) * 100)}%`, background: "var(--green)" }} />
                  </div>
                  <small className="tiny muted">{t("lens.lightingOk")}</small>
                </div>
                <button className="btn btn-g" onClick={() => retake(angle)}>
                  {t("lens.retake")}
                </button>
              </>
            )}

            {!preview && !isCam && (
              <>
                <div className="btn-row">
                  <button
                    className="btn btn-s"
                    onClick={() => startCamera(angle)}
                    disabled={!draft.consentPhoto || uploading === angle}
                  >
                    <Icon.camera size={18} /> {t("lens.capturePhoto")}
                  </button>
                  <label className="btn btn-g" style={{ textAlign: "center" }}>
                    {t("lens.uploadFallback")}
                    <input
                      type="file" accept="image/*" className="sr-only"
                      disabled={!draft.consentPhoto || uploading === angle}
                      onChange={(e) => onFile(angle, e.target.files?.[0])}
                    />
                  </label>
                </div>
                {camError && <p className="tiny" style={{ color: "var(--bad)" }}>{t("lens.cameraBlocked")}</p>}
                {!draft.consentPhoto && <p className="tiny muted">{t("lens.needConsentFirst")}</p>}
                {uploading === angle && <p className="tiny muted">{t("common.loading")}</p>}
              </>
            )}

            {isCam && (
              <div className="cameraview">
                <video ref={videoRef} playsInline muted />
                <GuideOverlay angle={angle} />
                <div style={{ position: "absolute", top: 10, left: 10, right: 10 }}>
                  <div className="lightmeter"><i style={{ width: `${Math.round((brightness / 255) * 100)}%` }} /></div>
                  <p className="tiny" style={{ color: "#fff", margin: 0, fontWeight: 700 }}>
                    {dark ? t("lens.tooDark") : t("lens.lightingOk")}
                  </p>
                </div>
                <button
                  className="shutter"
                  onClick={captureFromCamera}
                  disabled={dark || !draft.consentPhoto}
                  aria-label={t("lens.capturePhoto")}
                  title={dark ? t("lens.shutterDisabledDark") : t("lens.capturePhoto")}
                />
                <button
                  onClick={stopCamera}
                  style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,.5)", color: "#fff", border: 0, borderRadius: 999, minHeight: 44, minWidth: 44, cursor: "pointer" }}
                  aria-label={t("common.close")}
                >
                  <Icon.cross size={18} />
                </button>
              </div>
            )}
          </div>
        );
      })}

      <button className="btn btn-p" onClick={() => goStage("jara")}>
        {t("lens.goStage3")} →
      </button>
      <p className="tiny muted">{t("lens.need3")}</p>
      <button className="linklike" onClick={() => goStage("kahani")}>← {t("kahani.title")}</button>
    </div>
  );
}

function ConsentCheckbox({ label, onAgree, busy, tickFirst, agreeLabel }: {
  label: string; onAgree: () => void; busy: boolean; tickFirst: string; agreeLabel: string;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div>
      <label className="rowflex" style={{ margin: "10px 0", alignItems: "flex-start" }}>
        <input
          type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}
          style={{ width: 28, height: 28, minHeight: 28, marginTop: 2 }}
        />
        <span>{label}</span>
      </label>
      <button
        className="btn btn-p"
        disabled={busy}
        onClick={() => {
          if (!checked) {
            toast(tickFirst);
            return;
          }
          onAgree();
        }}
      >
        {busy ? "…" : agreeLabel}
      </button>
    </div>
  );
}

/**
 * Stage-2 verification wall for guests (P6).
 * Guest mode is fine until photos — here the guest verifies their phone via
 * OTP, which converts them into a real account and claims the in-progress
 * guest scan (claim_guest_scan_id on /auth/otp/verify). After success the
 * wall disappears and the Lens UI renders for the now-signed-in user.
 */
function GuestVerifyWall() {
  const { t } = useLang();
  const { scanId, reload } = useScan();
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const toE164 = (p: string) => `+977${p}`;

  async function sendOtp() {
    const p = phone.trim();
    if (!NEPAL_MOBILE.test(p)) {
      setError(t("login.invalidPhone"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.requestOtp(toE164(p));
      if (res.dev_code) setDevCode(res.dev_code); // dev/staging only
      setStep("otp");
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) {
      setError(t("login.invalidOtp"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // login() clears guest mode and claims the scan server-side.
      await login(toE164(phone.trim()), c, scanId || undefined);
      toast(t("auth.verifiedToast"));
      await reload(); // refresh scan detail + draft (guest flag flips off)
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>{t("lens.title")}</h1>
      <div className="card center">
        <div style={{ color: "var(--green)" }}><Icon.lock size={44} /></div>
        <h3>{t("auth.verifyGuestTitle")}</h3>
        <p className="muted">{t("auth.verifyGuestBody")}</p>
        {error && <ErrorCard message={error} />}
        {step === "phone" ? (
          <div style={{ textAlign: "left" }}>
            <label className="fl" htmlFor="gv-phone">{t("login.phoneLabel")}</label>
            <input
              id="gv-phone"
              type="tel"
              inputMode="numeric"
              placeholder={t("login.phonePlaceholder")}
              value={phone}
              maxLength={10}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              autoComplete="tel"
            />
            <button className="btn btn-p" onClick={sendOtp} disabled={busy}>
              {busy ? t("common.loading") : t("login.sendOtp")}
            </button>
          </div>
        ) : (
          <div style={{ textAlign: "left" }}>
            <label className="fl" htmlFor="gv-otp">{t("login.otpLabel")}</label>
            <input
              id="gv-otp"
              type="tel"
              inputMode="numeric"
              placeholder={t("login.otpPlaceholder")}
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoComplete="one-time-code"
            />
            {devCode && (
              <p className="tiny"><span className="kbd">dev: {devCode}</span></p>
            )}
            <button className="btn btn-p" onClick={verify} disabled={busy}>
              {busy ? t("login.loggingIn") : t("login.verify")}
            </button>
            <button className="linklike" onClick={() => setStep("phone")}>
              {t("common.back")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
