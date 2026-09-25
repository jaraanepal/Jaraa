import { useState } from "react";
import { Link } from "react-router-dom";
import { doctorApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import type { DoctorNoteSearchResult, ReplySnippet } from "../../api/types";

/**
 * Doctor batch-2 (008) toolkit: workload banner (D10), SLA banner (D11),
 * reply-snippet library (D12), bookmarked cases (D13), patient risk lookup
 * (D15), personal review stats (D17) and review-notes search (D18).
 * D14 (checklist) and D16 (photo request) live on the case detail page.
 */
export default function DoctorTools() {
  const { t } = useLang();
  const K = "p12b.doctor";

  const workload = useAsync(() => doctorApi.getWorkload());
  const sla = useAsync(() => doctorApi.getSlaSummary());
  const stats = useAsync(() => doctorApi.getStats());
  const bookmarks = useAsync(() => doctorApi.listBookmarks());

  // ---- D12 snippets ----
  const snippets = useAsync(() => doctorApi.listSnippets().then((r) => r.snippets));
  const [snTitle, setSnTitle] = useState("");
  const [snBody, setSnBody] = useState("");
  const [snBusy, setSnBusy] = useState(false);
  async function addSnippet() {
    if (!snTitle.trim() || !snBody.trim()) return;
    setSnBusy(true);
    try {
      await doctorApi.createSnippet({ title: snTitle.trim(), body_en: snBody.trim() });
      setSnTitle(""); setSnBody("");
      snippets.retry();
      toast(t(`${K}.snippetSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); } finally { setSnBusy(false); }
  }
  async function removeSnippet(s: ReplySnippet) {
    if (!window.confirm(t(`${K}.deleteSnippetConfirm`, { title: s.title }))) return;
    try { await doctorApi.deleteSnippet(s.id); snippets.retry(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- D15 risk lookup ----
  const [riskUserId, setRiskUserId] = useState("");
  const [risk, setRisk] = useState<{ level: string; red_flag_cases: number; missed_rescans: number } | null>(null);
  const [riskErr, setRiskErr] = useState<string | null>(null);
  async function lookupRisk() {
    if (!riskUserId.trim()) return;
    setRiskErr(null);
    try { setRisk(await doctorApi.patientRisk(riskUserId.trim())); }
    catch (e) { setRiskErr(apiErrorMessage(t, e)); setRisk(null); }
  }

  // ---- D18 notes search ----
  const [nq, setNq] = useState("");
  const [nresults, setNresults] = useState<DoctorNoteSearchResult[]>([]);
  const [nerr, setNerr] = useState<string | null>(null);
  async function searchNotes() {
    setNerr(null);
    try { setNresults((await doctorApi.searchNotes(nq)).results); }
    catch (e) { setNerr(apiErrorMessage(t, e)); }
  }

  return (
    <div className="page">
      <h1>{t(`${K}.title`)}</h1>

      {/* D10 workload banner — fields match the server contract
          { claimed, in_review, due_soon, overdue }. */}
      {workload.data && (
        <section className={`banner${workload.data.overdue > 0 ? " warn" : ""}`} aria-live="polite">
          <strong>{t(`${K}.workload`)}</strong>
          <span>
            {t(`${K}.workloadLine`, {
              claimed: workload.data.claimed,
              inReview: workload.data.in_review,
              dueSoon: workload.data.due_soon,
              overdue: workload.data.overdue,
            })}
          </span>
          {workload.data.overdue > 0 && <span className="chip warn">{t(`${K}.overdueChip`, { n: workload.data.overdue })}</span>}
        </section>
      )}

      {/* D11 SLA banner */}
      {sla.data && (sla.data.overdue > 0 || sla.data.due_6h > 0) && (
        <section className="banner warn" aria-live="polite">
          <strong>{t(`${K}.sla`)}</strong>
          <span>
            {t(`${K}.slaLine`, { overdue: sla.data.overdue, soon: sla.data.due_6h })}
          </span>
          <Link className="btn small" to="/doctor">{t(`${K}.openQueue`)}</Link>
        </section>
      )}

      {/* D17 personal stats — fields match the server contract
          { reviewed_7d, reviewed_30d, avg_review_hours }. */}
      <section>
        <h2>{t(`${K}.myStats`)}</h2>
        {stats.error ? <ErrorCard message={apiErrorMessage(t, stats.error)} onRetry={stats.retry} /> : null}
        {stats.data && (
          <div className="statgrid">
            <StatCard label={t(`${K}.reviewed7d`)} value={String(stats.data.reviewed_7d)} />
            <StatCard label={t(`${K}.reviewed30d`)} value={String(stats.data.reviewed_30d)} />
            <StatCard label={t(`${K}.avgReviewHours`)} value={stats.data.avg_review_hours == null ? "–" : String(stats.data.avg_review_hours)} />
          </div>
        )}
      </section>

      {/* D13 bookmarks */}
      <section>
        <h2>{t(`${K}.bookmarks`)}</h2>
        {bookmarks.error ? <ErrorCard message={apiErrorMessage(t, bookmarks.error)} onRetry={bookmarks.retry} /> : null}
        {bookmarks.data && bookmarks.data.case_ids.length === 0 && <EmptyState title={t(`${K}.noBookmarks`)} />}
        {bookmarks.data && bookmarks.data.case_ids.length > 0 && (
          <ul className="list">
            {bookmarks.data.case_ids.map((id) => (
              <li key={id}>
                <Link to={`/doctor/case/${id}`}>{id.slice(0, 8)}…</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* D12 snippets */}
      <section>
        <h2>{t(`${K}.snippets`)}</h2>
        <p className="muted">{t(`${K}.snippetsHint`)}</p>
        <div className="formrow">
          <input value={snTitle} onChange={(e) => setSnTitle(e.target.value)} placeholder={t(`${K}.snippetTitlePh`)} maxLength={120} />
          <textarea value={snBody} onChange={(e) => setSnBody(e.target.value)} placeholder={t(`${K}.snippetBodyPh`)} rows={2} maxLength={2000} />
          <button className="btn" disabled={snBusy || !snTitle.trim() || !snBody.trim()} onClick={addSnippet}>
            {t(`${K}.saveSnippet`)}
          </button>
        </div>
        {snippets.error ? <ErrorCard message={apiErrorMessage(t, snippets.error)} onRetry={snippets.retry} /> : null}
        {snippets.data && (
          <ul className="list">
            {snippets.data.map((s) => (
              <li key={s.id} className="listrow">
                <div><strong>{s.title}</strong><p className="muted">{s.body_en.slice(0, 120)}</p></div>
                <button className="btn small danger" onClick={() => removeSnippet(s)}>{t("common.delete")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* D15 risk lookup */}
      <section>
        <h2>{t(`${K}.riskLookup`)}</h2>
        <div className="formrow inline">
          <input value={riskUserId} onChange={(e) => setRiskUserId(e.target.value)} placeholder={t(`${K}.riskUserPh`)} />
          <button className="btn" onClick={lookupRisk}>{t(`${K}.check`)}</button>
        </div>
        {riskErr && <ErrorCard message={riskErr} />}
        {risk && (
          <p>
            <span className={`chip ${risk.level}`}>{t(`${K}.risk.${risk.level}`)}</span>{" "}
            {t(`${K}.riskLine`, { flags: risk.red_flag_cases, rescans: risk.missed_rescans })}
          </p>
        )}
      </section>

      {/* D18 notes search */}
      <section>
        <h2>{t(`${K}.notesSearch`)}</h2>
        <div className="formrow inline">
          <input value={nq} onChange={(e) => setNq(e.target.value)} placeholder={t(`${K}.notesSearchPh`)} minLength={2} />
          <button className="btn" disabled={nq.trim().length < 2} onClick={searchNotes}>{t("common.search")}</button>
        </div>
        {nerr && <ErrorCard message={nerr} />}
        {nresults.length > 0 && (
          <ul className="list">
            {nresults.map((r, i) => (
              <li key={`${r.case_id}-${r.created_at}-${i}`}>
                <Link to={`/doctor/case/${r.case_id}`}>{r.case_id.slice(0, 8)}…</Link>
                <p className="muted">{r.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
