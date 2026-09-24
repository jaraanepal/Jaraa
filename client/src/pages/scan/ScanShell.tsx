import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { scansApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { useAuth } from "../../auth/AuthContext";
import { ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { clearDraft, loadDraft, saveDraft } from "../../lib/draft";
import type { ScanDraft } from "../../lib/draft";
import type { ScanDetail, ScanStage } from "../../api/types";
import Kahani from "./Kahani";
import Lens from "./Lens";
import Jara from "./Jara";

export type LocalStage = "kahani" | "lens" | "jara" | "root_map";

interface ScanCtx {
  scanId: string;
  detail: ScanDetail | null;
  draft: ScanDraft;
  updateDraft: (patch: Partial<ScanDraft>) => void;
  stage: LocalStage;
  goStage: (s: LocalStage) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<ScanCtx | null>(null);
export function useScan(): ScanCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useScan outside ScanShell");
  return c;
}

const ORDER: LocalStage[] = ["kahani", "lens", "jara", "root_map"];

export default function ScanShell() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLang();
  const { isAuthed } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ScanDraft>(() => loadDraft());
  const [detail, setDetail] = useState<ScanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scanId = id ?? "";

  const reload = useCallback(async () => {
    if (!scanId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await scansApi.getScan(scanId);
      setDetail(d);
      // Hydrate the local draft from server state so the scan is resumable
      // on any device. Unresolved server flags merge into the draft.
      setDraft((prev) => {
        const serverFlags = d.red_flags.filter((f) => !f.resolved_at).map((f) => f.flag_type);
        const merged = [...prev.redFlags];
        for (const f of serverFlags) if (!merged.includes(f)) merged.push(f);
        const next = {
          ...prev,
          scanId,
          guest: !isAuthed,
          stage: (d.current_stage as LocalStage) ?? prev.stage,
          redFlags: merged,
        };
        saveDraft(next);
        return next;
      });
    } catch (e) {
      // Offline / no backend yet: keep working from the local draft (G6).
      setError(apiErrorMessage(t, e));
    } finally {
      setLoading(false);
    }
  }, [scanId, isAuthed, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  const updateDraft = useCallback((patch: Partial<ScanDraft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      saveDraft(next);
      return next;
    });
  }, []);

  const stage: LocalStage = draft.stage;

  const goStage = useCallback(
    async (s: LocalStage) => {
      // Best-effort server transition (rule-engine validated); the local
      // draft wins when offline.
      try {
        await scansApi.advanceStage(scanId, s as ScanStage);
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "guest_forbidden") {
          toast(t("errors.guest_forbidden"));
          navigate(`/login?returnTo=${encodeURIComponent(`/scan/${scanId}`)}`);
          return;
        }
        // Other failures (offline, illegal jump): keep local navigation.
      }
      updateDraft({ stage: s });
      window.scrollTo(0, 0);
    },
    [scanId, navigate, t, updateDraft],
  );

  if (loading && !detail && !draft.scanId) return <Loading />;
  if (!scanId) return <ErrorCard message={t("errors.not_found")} />;

  const ctx: ScanCtx = { scanId, detail, draft, updateDraft, stage, goStage, reload };

  return (
    <Ctx.Provider value={ctx}>
      <div className="screen">
        <div className="stepper" aria-hidden="true">
          {ORDER.map((s) => (
            <span key={s} className={ORDER.indexOf(s) < ORDER.indexOf(stage) ? "done" : s === stage ? "cur" : ""} />
          ))}
        </div>
        {error && detail === null && <ErrorCard message={error} onRetry={reload} />}
        {stage === "kahani" && <Kahani />}
        {stage === "lens" && <Lens />}
        {stage === "jara" && <Jara />}
        {stage === "root_map" && <RootMapRedirect />}
      </div>
    </Ctx.Provider>
  );
}

function RootMapRedirect() {
  const { scanId } = useScan();
  const navigate = useNavigate();
  useEffect(() => {
    navigate(`/scan/${scanId}/map`, { replace: true });
  }, [scanId, navigate]);
  return null;
}

/** Clear the local draft once a scan is submitted. */
export function finishDraft() {
  clearDraft();
}
