import { useState } from "react";
import { coachApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import type { ChallengeGroup, CustomerGoal } from "../../api/types";

/**
 * Coach batch-2 (008) toolkit: group challenges (C10), milestone badges
 * (C11), session summaries (C12), customer goals (C13), habit templates
 * (C14), weekly digest (C15), note templates (C16), risk flags (C17) and
 * article assignment (C18).
 */
export default function CoachTools() {
  const { t } = useLang();
  const K = "p12b.coach";

  // ---- C10 challenge groups ----
  const groups = useAsync(() => coachApi.listChallengeGroups().then((r) => r.groups));
  const [gTitle, setGTitle] = useState("");
  const [gDesc, setGDesc] = useState("");
  const [assignUser, setAssignUser] = useState<Record<string, string>>({});
  async function addGroup() {
    if (!gTitle.trim()) return;
    try {
      await coachApi.createChallengeGroup({ title_en: gTitle.trim(), description_en: gDesc.trim() || undefined });
      setGTitle(""); setGDesc("");
      groups.retry();
      toast(t(`${K}.groupSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function assignToGroup(g: ChallengeGroup) {
    const userId = (assignUser[g.id] ?? "").trim();
    if (!userId) return;
    try {
      await coachApi.assignChallengeGroup(g.id, userId);
      setAssignUser((v) => ({ ...v, [g.id]: "" }));
      groups.retry();
      toast(t(`${K}.assigned`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- C11 badges ----
  const [badgeUser, setBadgeUser] = useState("");
  const [badgeSlug, setBadgeSlug] = useState("streak_7");
  const [badges, setBadges] = useState<{ id: string; badge: string; created_at: string }[] | null>(null);
  async function awardBadge() {
    if (!badgeUser.trim()) return;
    try {
      await coachApi.awardBadge(badgeUser.trim(), badgeSlug.trim());
      setBadges((await coachApi.listBadges(badgeUser.trim())).badges);
      toast(t(`${K}.badgeAwarded`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- C12 session summaries ----
  const [sumUser, setSumUser] = useState("");
  const [sumText, setSumText] = useState("");
  const [summaries, setSummaries] = useState<{ id: string; summary: string; created_at: string }[] | null>(null);
  async function addSummary() {
    if (!sumUser.trim() || !sumText.trim()) return;
    try {
      await coachApi.addSessionSummary(sumUser.trim(), sumText.trim());
      setSumText("");
      setSummaries((await coachApi.listSessionSummaries(sumUser.trim())).sessions);
      toast(t(`${K}.summarySaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function loadSummaries() {
    if (!sumUser.trim()) return;
    try { setSummaries((await coachApi.listSessionSummaries(sumUser.trim())).sessions); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- C13 goals ----
  const [goalUser, setGoalUser] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [goals, setGoals] = useState<CustomerGoal[] | null>(null);
  async function loadGoals() {
    if (!goalUser.trim()) return;
    try { setGoals((await coachApi.listCustomerGoals(goalUser.trim())).goals); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function addGoal() {
    if (!goalUser.trim() || !goalTitle.trim()) return;
    try {
      await coachApi.createCustomerGoal(goalUser.trim(), { title_en: goalTitle.trim(), target_date: goalDate || undefined });
      setGoalTitle(""); setGoalDate("");
      loadGoals();
      toast(t(`${K}.goalSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function completeGoal(g: CustomerGoal) {
    try { await coachApi.completeCustomerGoal(g.id); loadGoals(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function removeGoal(g: CustomerGoal) {
    if (!window.confirm(t(`${K}.deleteConfirm`, { name: g.title_en }))) return;
    try { await coachApi.deleteCustomerGoal(g.id); loadGoals(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- C14 habit templates ----
  const habitTemplates = useAsync(() => coachApi.listHabitTemplates().then((r) => r.templates));
  const [htTitle, setHtTitle] = useState("");
  const [htDesc, setHtDesc] = useState("");
  async function addHabitTemplate() {
    if (!htTitle.trim()) return;
    try {
      await coachApi.createHabitTemplate({ title_en: htTitle.trim(), description_en: htDesc.trim() || undefined });
      setHtTitle(""); setHtDesc("");
      habitTemplates.retry();
      toast(t(`${K}.templateSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  const [editHt, setEditHt] = useState<string | null>(null);
  const [editHtTitle, setEditHtTitle] = useState("");
  async function saveHabitTemplateEdit(id: string) {
    if (!editHtTitle.trim()) return;
    try {
      await coachApi.updateHabitTemplate(id, { title_en: editHtTitle.trim() });
      setEditHt(null);
      habitTemplates.retry();
      toast(t(`${K}.templateSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function removeHabitTemplate(id: string, title: string) {
    if (!window.confirm(t(`${K}.deleteConfirm`, { name: title }))) return;
    try { await coachApi.deleteHabitTemplate(id); habitTemplates.retry(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- C15 digest ----
  const [dgHeadline, setDgHeadline] = useState("");
  const [dgBody, setDgBody] = useState("");
  const [dgPreview, setDgPreview] = useState<{ at_risk_count: number } | null>(null);
  async function previewDigest() {
    try { setDgPreview(await coachApi.digestPreview()); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function sendDigest() {
    if (!dgHeadline.trim()) return;
    if (!window.confirm(t(`${K}.digestConfirm`, { n: dgPreview?.at_risk_count ?? 0 }))) return;
    try {
      const r = await coachApi.sendDigest({ headline_en: dgHeadline.trim(), body_en: dgBody.trim() || undefined });
      setDgHeadline(""); setDgBody(""); setDgPreview(null);
      toast(t(`${K}.digestSent`, { n: r.sent }));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- C16 note templates ----
  const noteTemplates = useAsync(() => coachApi.listNoteTemplates().then((r) => r.templates));
  const [ntTitle, setNtTitle] = useState("");
  const [ntBody, setNtBody] = useState("");
  async function addNoteTemplate() {
    if (!ntTitle.trim() || !ntBody.trim()) return;
    try {
      await coachApi.createNoteTemplate({ title: ntTitle.trim(), body_en: ntBody.trim() });
      setNtTitle(""); setNtBody("");
      noteTemplates.retry();
      toast(t(`${K}.templateSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  const [editNt, setEditNt] = useState<string | null>(null);
  const [editNtBody, setEditNtBody] = useState("");
  async function saveNoteTemplateEdit(id: string) {
    if (!editNtBody.trim()) return;
    try {
      await coachApi.updateNoteTemplate(id, { body_en: editNtBody.trim() });
      setEditNt(null);
      noteTemplates.retry();
      toast(t(`${K}.templateSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function removeNoteTemplate(id: string, title: string) {
    if (!window.confirm(t(`${K}.deleteConfirm`, { name: title }))) return;
    try { await coachApi.deleteNoteTemplate(id); noteTemplates.retry(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- C17 risk flags / C18 article assign ----
  const riskFlags = useAsync(() => coachApi.riskFlags().then((r) => r.flags));
  const articles = useAsync(() => coachApi.listArticles().then((r) => r.articles));
  const [artId, setArtId] = useState("");
  const [artUser, setArtUser] = useState("");
  async function assignArticle() {
    if (!artId || !artUser.trim()) return;
    try {
      await coachApi.assignArticle(artId, artUser.trim());
      setArtUser("");
      toast(t(`${K}.articleAssigned`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }

  return (
    <div className="page">
      <h1>{t(`${K}.title`)}</h1>

      {/* C17 risk flags */}
      <section>
        <h2>{t(`${K}.riskFlags`)}</h2>
        {riskFlags.error ? <ErrorCard message={apiErrorMessage(t, riskFlags.error)} onRetry={riskFlags.retry} /> : null}
        {riskFlags.data && riskFlags.data.length === 0 && <EmptyState title={t(`${K}.noRisk`)} />}
        {riskFlags.data && riskFlags.data.length > 0 && (
          <ul className="list">
            {riskFlags.data.map((f) => (
              <li key={f.user_id} className="listrow">
                <div><strong>{f.name ?? f.user_id.slice(0, 8)}</strong><p className="muted">{t(`${K}.missedCheckins`, { n: f.missed_checkins })}</p></div>
                <span className="chip warn">{t(`${K}.atRisk`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* C10 challenge groups */}
      <section>
        <h2>{t(`${K}.groups`)}</h2>
        <div className="formrow">
          <input value={gTitle} onChange={(e) => setGTitle(e.target.value)} placeholder={t(`${K}.groupTitlePh`)} maxLength={200} />
          <textarea value={gDesc} onChange={(e) => setGDesc(e.target.value)} placeholder={t(`${K}.groupDescPh`)} rows={2} maxLength={1000} />
          <button className="btn" disabled={!gTitle.trim()} onClick={addGroup}>{t("common.add")}</button>
        </div>
        {groups.error ? <ErrorCard message={apiErrorMessage(t, groups.error)} onRetry={groups.retry} /> : null}
        {groups.data && groups.data.map((g) => (
          <div className="card" key={g.id}>
            <div className="rowflex">
              <div><strong>{g.title_en}</strong><p className="muted">{t(`${K}.members`, { n: g.member_count ?? 0 })}</p></div>
            </div>
            <div className="formrow inline">
              <input value={assignUser[g.id] ?? ""} onChange={(e) => setAssignUser((v) => ({ ...v, [g.id]: e.target.value }))} placeholder={t(`${K}.customerIdPh`)} />
              <button className="btn small" disabled={!(assignUser[g.id] ?? "").trim()} onClick={() => assignToGroup(g)}>{t(`${K}.assign`)}</button>
            </div>
          </div>
        ))}
      </section>

      {/* C11 badges */}
      <section>
        <h2>{t(`${K}.badges`)}</h2>
        <div className="formrow inline">
          <input value={badgeUser} onChange={(e) => setBadgeUser(e.target.value)} placeholder={t(`${K}.customerIdPh`)} />
          <input value={badgeSlug} onChange={(e) => setBadgeSlug(e.target.value)} placeholder={t(`${K}.badgePh`)} maxLength={40} />
          <button className="btn" disabled={!badgeUser.trim() || !badgeSlug.trim()} onClick={awardBadge}>{t(`${K}.award`)}</button>
        </div>
        {badges && (
          <ul className="list">
            {badges.map((b) => (
              <li key={b.id}><span className="chip">{b.badge}</span> <span className="muted tiny">{b.created_at.slice(0, 10)}</span></li>
            ))}
          </ul>
        )}
      </section>

      {/* C12 session summaries */}
      <section>
        <h2>{t(`${K}.sessions`)}</h2>
        <div className="formrow inline">
          <input value={sumUser} onChange={(e) => setSumUser(e.target.value)} placeholder={t(`${K}.customerIdPh`)} />
          <button className="btn" disabled={!sumUser.trim()} onClick={loadSummaries}>{t(`${K}.load`)}</button>
        </div>
        <div className="formrow">
          <textarea value={sumText} onChange={(e) => setSumText(e.target.value)} placeholder={t(`${K}.summaryPh`)} rows={3} maxLength={2000} />
          <button className="btn" disabled={!sumUser.trim() || !sumText.trim()} onClick={addSummary}>{t(`${K}.saveSummary`)}</button>
        </div>
        {summaries && summaries.map((s) => (
          <div className="card" key={s.id}>
            <p>{s.summary}</p>
            <p className="muted tiny">{s.created_at.slice(0, 16).replace("T", " ")}</p>
          </div>
        ))}
      </section>

      {/* C13 goals */}
      <section>
        <h2>{t(`${K}.goals`)}</h2>
        <div className="formrow inline">
          <input value={goalUser} onChange={(e) => setGoalUser(e.target.value)} placeholder={t(`${K}.customerIdPh`)} />
          <button className="btn" disabled={!goalUser.trim()} onClick={loadGoals}>{t(`${K}.load`)}</button>
        </div>
        <div className="formrow inline">
          <input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder={t(`${K}.goalTitlePh`)} maxLength={200} />
          <input type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)} aria-label={t(`${K}.targetDate`)} />
          <button className="btn" disabled={!goalUser.trim() || !goalTitle.trim()} onClick={addGoal}>{t("common.add")}</button>
        </div>
        {goals && (
          <ul className="list">
            {goals.map((g) => (
              <li key={g.id} className="listrow">
                <div>
                  <strong>{g.title_en}</strong>
                  <p className="muted">{g.target_date ?? "—"}{g.done_at ? ` · ✓ ${g.done_at.slice(0, 10)}` : ""}</p>
                </div>
                <div className="rowflex">
                  {!g.done_at && <button className="btn small" onClick={() => completeGoal(g)}>{t(`${K}.complete`)}</button>}
                  <button className="btn small danger" onClick={() => removeGoal(g)}>{t("common.delete")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* C14 habit templates */}
      <section>
        <h2>{t(`${K}.habitTemplates`)}</h2>
        <div className="formrow inline">
          <input value={htTitle} onChange={(e) => setHtTitle(e.target.value)} placeholder={t(`${K}.templateTitlePh`)} maxLength={200} />
          <input value={htDesc} onChange={(e) => setHtDesc(e.target.value)} placeholder={t(`${K}.templateDescPh`)} maxLength={1000} />
          <button className="btn" disabled={!htTitle.trim()} onClick={addHabitTemplate}>{t("common.add")}</button>
        </div>
        {habitTemplates.error ? <ErrorCard message={apiErrorMessage(t, habitTemplates.error)} onRetry={habitTemplates.retry} /> : null}
        {habitTemplates.data && (
          <ul className="list">
            {habitTemplates.data.map((x) => (
              <li key={x.id} className="listrow">
                <div>
                  <strong>{x.title_en}</strong>{x.description_en && <p className="muted">{x.description_en.slice(0, 120)}</p>}
                  {editHt === x.id && (
                    <div className="formrow inline" style={{ marginTop: 8 }}>
                      <input value={editHtTitle} onChange={(e) => setEditHtTitle(e.target.value)} maxLength={200} aria-label={t(`${K}.templateTitlePh`)} />
                      <button className="btn small" onClick={() => saveHabitTemplateEdit(x.id)}>{t("common.save")}</button>
                      <button className="btn small btn-g" onClick={() => setEditHt(null)}>{t("common.cancel")}</button>
                    </div>
                  )}
                </div>
                <div className="rowflex">
                  {editHt !== x.id && (
                    <button className="btn small" onClick={() => { setEditHt(x.id); setEditHtTitle(x.title_en); }}>{t("common.edit")}</button>
                  )}
                  <button className="btn small danger" onClick={() => removeHabitTemplate(x.id, x.title_en)}>{t("common.delete")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* C15 digest */}
      <section>
        <h2>{t(`${K}.digest`)}</h2>
        <div className="formrow">
          <input value={dgHeadline} onChange={(e) => setDgHeadline(e.target.value)} placeholder={t(`${K}.digestHeadlinePh`)} maxLength={200} />
          <textarea value={dgBody} onChange={(e) => setDgBody(e.target.value)} placeholder={t(`${K}.digestBodyPh`)} rows={2} maxLength={1000} />
          <div className="rowflex">
            <button className="btn btn-g" onClick={previewDigest}>{t(`${K}.preview`)}</button>
            <button className="btn btn-p" disabled={!dgHeadline.trim()} onClick={sendDigest}>{t(`${K}.send`)}</button>
          </div>
          {dgPreview && <p className="muted">{t(`${K}.digestPreview`, { n: dgPreview.at_risk_count })}</p>}
        </div>
      </section>

      {/* C16 note templates */}
      <section>
        <h2>{t(`${K}.noteTemplates`)}</h2>
        <div className="formrow inline">
          <input value={ntTitle} onChange={(e) => setNtTitle(e.target.value)} placeholder={t(`${K}.templateTitlePh`)} maxLength={120} />
          <input value={ntBody} onChange={(e) => setNtBody(e.target.value)} placeholder={t(`${K}.templateBodyPh`)} maxLength={2000} />
          <button className="btn" disabled={!ntTitle.trim() || !ntBody.trim()} onClick={addNoteTemplate}>{t("common.add")}</button>
        </div>
        {noteTemplates.error ? <ErrorCard message={apiErrorMessage(t, noteTemplates.error)} onRetry={noteTemplates.retry} /> : null}
        {noteTemplates.data && (
          <ul className="list">
            {noteTemplates.data.map((x) => (
              <li key={x.id} className="listrow">
                <div>
                  <strong>{x.title}</strong><p className="muted">{x.body_en.slice(0, 120)}</p>
                  {editNt === x.id && (
                    <div className="formrow inline" style={{ marginTop: 8 }}>
                      <input value={editNtBody} onChange={(e) => setEditNtBody(e.target.value)} maxLength={2000} aria-label={t(`${K}.templateBodyPh`)} />
                      <button className="btn small" onClick={() => saveNoteTemplateEdit(x.id)}>{t("common.save")}</button>
                      <button className="btn small btn-g" onClick={() => setEditNt(null)}>{t("common.cancel")}</button>
                    </div>
                  )}
                </div>
                <div className="rowflex">
                  {editNt !== x.id && (
                    <button className="btn small" onClick={() => { setEditNt(x.id); setEditNtBody(x.body_en); }}>{t("common.edit")}</button>
                  )}
                  <button className="btn small danger" onClick={() => removeNoteTemplate(x.id, x.title)}>{t("common.delete")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* C18 article assignment */}
      <section>
        <h2>{t(`${K}.assignArticle`)}</h2>
        <div className="formrow inline">
          <select value={artId} onChange={(e) => setArtId(e.target.value)} aria-label={t(`${K}.article`)}>
            <option value="">{t(`${K}.pickArticle`)}</option>
            {(articles.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title_en}</option>)}
          </select>
          <input value={artUser} onChange={(e) => setArtUser(e.target.value)} placeholder={t(`${K}.customerIdPh`)} />
          <button className="btn" disabled={!artId || !artUser.trim()} onClick={assignArticle}>{t(`${K}.assign`)}</button>
        </div>
      </section>
    </div>
  );
}
