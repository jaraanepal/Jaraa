import { useState } from "react";
import { adminB3Api, type PlanTemplate } from "../../api/b3admin";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, Modal, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/**
 * A24 — plan template manager: list, create, edit (titles + items as JSON),
 * active toggle, delete with confirm.
 */
export default function AdminPlanTemplates() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    adminB3Api.listPlanTemplates().then((r) => r.templates),
  );
  const [templates, setTemplates] = useState<PlanTemplate[] | null>(null);
  const [editing, setEditing] = useState<PlanTemplate | null | "new">(null);
  const [titleEn, setTitleEn] = useState("");
  const [titleNe, setTitleNe] = useState("");
  const [itemsJson, setItemsJson] = useState("[]");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const errMsg = error ? apiErrorMessage(t, error) : null;

  const shown = templates ?? data;

  function openEditor(tmpl: PlanTemplate | "new") {
    setFormError(null);
    if (tmpl === "new") {
      setTitleEn("");
      setTitleNe("");
      setItemsJson("[]");
    } else {
      setTitleEn(tmpl.title_en);
      setTitleNe(tmpl.title_ne ?? "");
      setItemsJson(JSON.stringify(tmpl.items, null, 2));
    }
    setEditing(tmpl);
  }

  function remove(id: string) {
    setTemplates((p) => (p ?? []).filter((x) => x.id !== id));
  }

  async function save() {
    if (!titleEn.trim()) {
      setFormError(t("p12c.admin.planTemplates.titleRequired"));
      return;
    }
    let items: unknown[];
    try {
      const parsed: unknown = JSON.parse(itemsJson || "[]");
      if (!Array.isArray(parsed)) throw new Error("not an array");
      items = parsed;
    } catch {
      setFormError(t("p12c.admin.planTemplates.items"));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing === "new") {
        const r = await adminB3Api.createPlanTemplate({
          title_en: titleEn.trim(),
          title_ne: titleNe.trim() || null,
          items,
        });
        setTemplates((p) => [r.template, ...(p ?? data ?? [])]);
        toast(t("common.done"));
      } else if (editing) {
        const r = await adminB3Api.updatePlanTemplate(editing.id, {
          title_en: titleEn.trim(),
          title_ne: titleNe.trim() || null,
          items,
        });
        setTemplates((p) => (p ?? data ?? []).map((x) => (x.id === editing.id ? r.template : x)));
        toast(t("common.done"));
      }
      setEditing(null);
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(tmpl: PlanTemplate) {
    try {
      const r = await adminB3Api.updatePlanTemplate(tmpl.id, { is_active: !tmpl.is_active });
      setTemplates((p) => (p ?? data ?? []).map((x) => (x.id === tmpl.id ? r.template : x)));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  async function del(tmpl: PlanTemplate) {
    if (!window.confirm(t("p12c.admin.planTemplates.confirmDelete"))) return;
    setDeleting(tmpl.id);
    try {
      await adminB3Api.deletePlanTemplate(tmpl.id);
      remove(tmpl.id);
      toast(t("common.done"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="screen">
      <div className="rowflex">
        <div>
          <h1 style={{ marginBottom: 0 }}>{t("p12c.admin.planTemplates.title")}</h1>
        </div>
        <span className="spacer" />
        <button className="btn btn-p" onClick={() => openEditor("new")}>
          {t("p12c.admin.planTemplates.create")}
        </button>
      </div>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && (shown ?? []).length === 0 && (
        <EmptyState icon={<Icon.doc size={32} />} title={t("p12c.admin.planTemplates.empty")} />
      )}

      {(shown ?? []).map((tmpl) => (
        <div className="card" key={tmpl.id}>
          <div className="rowflex">
            <div>
              <b>{tmpl.title_en}</b>
              {tmpl.title_ne && <div className="tiny muted">{tmpl.title_ne}</div>}
              <div className="tiny muted">
                {t("p12c.admin.planTemplates.items")}: {(tmpl.items ?? []).length}
              </div>
            </div>
            <span className="spacer" />
            <button
              className={`chip${tmpl.is_active ? "" : " grey"}`}
              onClick={() => toggleActive(tmpl)}
              style={{ cursor: "pointer" }}
            >
              {tmpl.is_active ? t("p12c.admin.planTemplates.active") : t("p12c.admin.planTemplates.inactive")}
            </button>
          </div>
          <div className="btn-row">
            <button className="btn btn-s" onClick={() => openEditor(tmpl)}>
              {t("p12c.admin.planTemplates.edit")}
            </button>
            <button className="btn btn-g" disabled={deleting === tmpl.id} onClick={() => del(tmpl)}>
              {t("p12c.admin.planTemplates.delete")}
            </button>
          </div>
        </div>
      ))}

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <h3 style={{ marginTop: 0 }}>
            {editing === "new" ? t("p12c.admin.planTemplates.create") : t("p12c.admin.planTemplates.edit")}
          </h3>
          {formError && <ErrorCard message={formError} />}
          <label className="fl">{t("p12c.admin.planTemplates.titleEn")}</label>
          <input type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
          <label className="fl">{t("p12c.admin.planTemplates.titleNe")}</label>
          <input type="text" value={titleNe} onChange={(e) => setTitleNe(e.target.value)} />
          <label className="fl">{t("p12c.admin.planTemplates.items")} (JSON)</label>
          <textarea
            value={itemsJson}
            onChange={(e) => setItemsJson(e.target.value)}
            rows={6}
            style={{ fontFamily: "monospace" }}
          />
          <div className="btn-row">
            <button className="btn btn-p" disabled={saving} onClick={save}>
              {saving ? t("common.loading") : t("p12c.admin.planTemplates.save")}
            </button>
            <button className="btn btn-g" onClick={() => setEditing(null)}>
              {t("p12c.admin.planTemplates.cancel")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
