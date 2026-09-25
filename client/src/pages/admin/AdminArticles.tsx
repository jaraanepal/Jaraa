import { useState } from "react";
import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import type { EducationArticle } from "../../api/types";

/**
 * A8: education article management — list, create, edit, publish /
 * unpublish, delete (with confirm).
 */
export default function AdminArticles() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    adminApi.listArticles().then((r) => r.articles),
  );
  const listError = error ? apiErrorMessage(t, error) : null;

  const [editing, setEditing] = useState<EducationArticle | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [titleEn, setTitleEn] = useState("");
  const [titleNe, setTitleNe] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [bodyNe, setBodyNe] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setTitleEn("");
    setTitleNe("");
    setBodyEn("");
    setBodyNe("");
    setIsPublished(false);
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(a: EducationArticle) {
    setEditing(a);
    setTitleEn(a.title_en);
    setTitleNe(a.title_ne ?? "");
    setBodyEn(a.body_en);
    setBodyNe(a.body_ne ?? "");
    setIsPublished(a.is_published);
    setFormError(null);
    setShowForm(true);
  }

  async function save() {
    if (!titleEn.trim() || !bodyEn.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      if (editing) {
        await adminApi.updateArticle(editing.id, {
          title_en: titleEn.trim(),
          title_ne: titleNe.trim() || null,
          body_en: bodyEn.trim(),
          body_ne: bodyNe.trim() || null,
          is_published: isPublished,
        });
      } else {
        await adminApi.createArticle({
          title_en: titleEn.trim(),
          title_ne: titleNe.trim() || undefined,
          body_en: bodyEn.trim(),
          body_ne: bodyNe.trim() || undefined,
          is_published: isPublished,
        });
      }
      toast(t("p12.admin.articleSaved"));
      setShowForm(false);
      retry();
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(a: EducationArticle) {
    try {
      await adminApi.updateArticle(a.id, { is_published: !a.is_published });
      retry();
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    }
  }

  async function remove(a: EducationArticle) {
    if (!window.confirm(`${t("p12.admin.delete")}: ${a.title_en}?`)) return;
    try {
      await adminApi.deleteArticle(a.id);
      toast(t("p12.admin.articleDeleted"));
      retry();
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    }
  }

  const articles = data ?? [];

  return (
    <div className="screen">
      <div className="rowflex">
        <h1 style={{ flex: 1, marginBottom: 0 }}>{t("p12.admin.articles")}</h1>
        <button className="btn btn-p" style={{ width: "auto", margin: 0 }} onClick={openCreate}>
          + {t("p12.admin.newArticle")}
        </button>
      </div>

      {formError && <ErrorCard message={formError} />}

      {showForm && (
        <div className="card" style={{ borderColor: "var(--gold)" }}>
          <h3 style={{ marginTop: 0 }}>{editing ? t("p12.admin.edit") : t("p12.admin.newArticle")}</h3>
          <label className="fl" htmlFor="ar-title-en">{t("p12.admin.titleEnPh")}</label>
          <input
            id="ar-title-en"
            type="text"
            placeholder={t("p12.admin.titleEnPh")}
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
          />
          <label className="fl" htmlFor="ar-title-ne">{t("p12.admin.titleNePh")}</label>
          <input
            id="ar-title-ne"
            type="text"
            placeholder={t("p12.admin.titleNePh")}
            value={titleNe}
            onChange={(e) => setTitleNe(e.target.value)}
          />
          <label className="fl" htmlFor="ar-body-en">{t("p12.admin.bodyEnPh")}</label>
          <textarea
            id="ar-body-en"
            rows={4}
            placeholder={t("p12.admin.bodyEnPh")}
            value={bodyEn}
            onChange={(e) => setBodyEn(e.target.value)}
          />
          <label className="fl" htmlFor="ar-body-ne">{t("p12.admin.bodyNePh")}</label>
          <textarea
            id="ar-body-ne"
            rows={4}
            placeholder={t("p12.admin.bodyNePh")}
            value={bodyNe}
            onChange={(e) => setBodyNe(e.target.value)}
          />
          <label className="tiny" style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "4px 0 8px" }}>
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              style={{ width: 24, height: 24, minHeight: 24 }}
            />
            {t("p12.admin.publish")}
          </label>
          <div className="btn-row">
            <button
              className="btn btn-p"
              style={{ width: "auto", margin: 0 }}
              disabled={busy || !titleEn.trim() || !bodyEn.trim()}
              onClick={save}
            >
              {busy ? t("common.loading") : t("p12.common.save")}
            </button>
            <button className="linklike" onClick={() => setShowForm(false)}>
              {t("p12.common.cancel")}
            </button>
          </div>
        </div>
      )}

      {loading && <Loading />}
      {listError && <ErrorCard message={listError} onRetry={retry} />}

      {!loading && !error && articles.length === 0 && (
        <EmptyState icon={<Icon.book size={32} />} title={t("p12.admin.articles")} />
      )}

      {articles.map((a) => (
        <div className="card" key={a.id}>
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <b>{a.title_en}</b>
              {a.title_ne && <div className="tiny">{a.title_ne}</div>}
              <div className="tiny muted">{a.updated_at.slice(0, 10)}</div>
            </div>
            <Chip tone={a.is_published ? undefined : "grey"}>
              {a.is_published ? t("p12.admin.publish") : t("p12.admin.unpublish")}
            </Chip>
          </div>
          <div className="btn-row">
            <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => openEdit(a)}>
              {t("p12.admin.edit")}
            </button>
            <button className="linklike" onClick={() => togglePublish(a)}>
              {a.is_published ? t("p12.admin.unpublish") : t("p12.admin.publish")}
            </button>
            <button className="linklike" style={{ color: "var(--bad)" }} onClick={() => remove(a)}>
              {t("p12.admin.delete")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
