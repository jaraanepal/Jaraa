import { useEffect, useRef, useState } from "react";
import { adminKitsApi } from "../../api/client";
import { adminB3Api } from "../../api/b3admin";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { kitPayload, parseIncluded, type KitFormValues } from "../../lib/kitForm";
import type { AdminKit } from "../../api/types";

const PAGE_SIZE = 10;

const EMPTY_FORM: KitFormValues = {
  name: "",
  description: "",
  priceNpr: "",
  category: "",
  stock: "",
  includedText: "",
  usageInstructions: "",
  isActive: true,
};

function toForm(k: AdminKit): KitFormValues {
  return {
    name: k.name_en,
    description: k.name_ne ?? "",
    priceNpr: String(k.total_npr),
    category: k.category ?? "",
    stock: String(k.stock),
    includedText: k.whats_included ?? "",
    usageInstructions: k.usage_instructions ?? "",
    isActive: k.is_active,
  };
}

function KitForm({
  initial,
  onDone,
}: {
  initial: { kit: AdminKit } | null;
  onDone: () => void;
}) {
  const { t } = useLang();
  const [v, setV] = useState<KitFormValues>(initial ? toForm(initial.kit) : EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busyImage, setBusyImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = newFiles.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [newFiles]);

  const set = (k: keyof KitFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";
    setNewFiles((p) => [...p, ...files]);
  }

  const [existingImages, setExistingImages] = useState<string[]>(initial?.kit.images ?? []);

  async function removeExistingImage(imageUrl: string) {
    if (!initial || !window.confirm(t("adminKits.removeImage") + "?")) return;
    setBusyImage(imageUrl);
    try {
      const r = await adminKitsApi.deleteImage(initial.kit.id, imageUrl);
      setExistingImages(r.images);
      toast(t("common.done"));
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    } finally {
      setBusyImage(null);
    }
  }

  async function save() {
    const payload = kitPayload(v);
    if ("error" in payload) {
      setFormError(t(payload.error));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const saved = initial
        ? await adminKitsApi.update(initial.kit.id, payload)
        : await adminKitsApi.create(payload);
      if (newFiles.length > 0) {
        await adminKitsApi.uploadImages(saved.id, newFiles).catch((e) => {
          if ((e as { status?: number }).status === 404) return undefined; // images unsupported — kit is saved anyway
          throw e;
        });
      }
      toast(t("adminKits.saved"));
      onDone();
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="card formgrid">
      <h3 style={{ marginTop: 0 }}>{initial ? t("adminKits.edit") : t("adminKits.create")}</h3>
      {formError && <ErrorCard message={formError} />}
      <label className="fl">{t("adminKits.name")}</label>
      <input type="text" value={v.name} onChange={set("name")} placeholder={t("adminKits.namePh")} />
      <label className="fl">{t("adminKits.description")}</label>
      <textarea value={v.description} onChange={set("description")} rows={3} />
      <label className="fl">{t("adminKits.price")}</label>
      <input type="number" min={1} inputMode="numeric" value={v.priceNpr} onChange={set("priceNpr")} />
      <label className="fl">{t("adminKits.category")}</label>
      <input type="text" value={v.category} onChange={set("category")} placeholder={t("adminKits.categoryPh")} />
      <label className="fl">{t("adminKits.stock")}</label>
      <input type="number" min={0} inputMode="numeric" value={v.stock} onChange={set("stock")} />
      <label className="fl">{t("adminKits.included")}</label>
      <textarea value={v.includedText} onChange={set("includedText")} rows={3} placeholder={t("adminKits.includedPh")} />
      <label className="fl">{t("adminKits.usage")}</label>
      <textarea value={v.usageInstructions} onChange={set("usageInstructions")} rows={3} />
      <label className="rowflex" style={{ marginTop: 12, gap: 10 }}>
        <input type="checkbox" checked={v.isActive} onChange={set("isActive")} style={{ width: 22, height: 22 }} />
        <b>{t("adminKits.active")}</b>
      </label>

      <h4>{t("adminKits.images")}</h4>
      <div className="kitimg-row">
        {existingImages.map((url) => (
          <div className="kitimg" key={url}>
            <img src={url} alt="" />
            <button
              onClick={() => removeExistingImage(url)}
              disabled={busyImage === url}
              aria-label={t("adminKits.removeImage")}
            >
              <Icon.cross size={16} />
            </button>
          </div>
        ))}
        {previews.map((u, i) => (
          <div className="kitimg" key={u}>
            <img src={u} alt="" />
            <button
              onClick={() => setNewFiles((p) => p.filter((_, j) => j !== i))}
              aria-label={t("adminKits.removeImage")}
            >
              <Icon.cross size={16} />
            </button>
          </div>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={pickFiles} aria-label={t("adminKits.addImages")} />
      <button className="btn btn-s" onClick={() => fileRef.current?.click()}>
        {t("adminKits.addImages")}
      </button>

      <div className="btn-row">
        <button className="btn btn-p" disabled={saving} onClick={save}>
          {saving ? t("common.loading") : t("common.save")}
        </button>
        <button className="btn btn-g" onClick={onDone}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/** A26 — ranked table of kits by orders + revenue (cancelled orders excluded). */
function KitLeaderboard() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    adminB3Api.kitLeaderboard().then((r) => r.leaderboard),
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;

  return (
    <div>
      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.box size={32} />} title={t("p12c.admin.kitLeaderboard.empty")} />
      )}

      {!loading && !error && (data ?? []).length > 0 && (
        <div className="card">
          <table className="tiny" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>#</th>
                <th style={{ textAlign: "left" }}>{t("p12c.admin.kitLeaderboard.kit")}</th>
                <th style={{ textAlign: "right" }}>{t("p12c.admin.kitLeaderboard.orders")}</th>
                <th style={{ textAlign: "right" }}>{t("p12c.admin.kitLeaderboard.revenue")}</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row, i) => (
                <tr key={row.kit_id}>
                  <td>{i + 1}</td>
                  <td><b>{row.name}</b></td>
                  <td style={{ textAlign: "right" }}>{row.orders}</td>
                  <td style={{ textAlign: "right" }}>{row.revenue_npr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Admin kit management: search/filter/pagination, create/edit, soft-delete. */
export default function AdminKits() {
  const { t } = useLang();
  const [tab, setTab] = useState<"kits" | "leaderboard">("kits");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [category, setCategory] = useState("");
  const [active, setActive] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [kits, setKits] = useState<AdminKit[]>([]);
  const [total, setTotal] = useState(0);
  const [cats, setCats] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminKit | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(id);
  }, [q]);

  const load = () => {
    setLoading(true);
    adminKitsApi
      .list({
        q: debouncedQ || undefined,
        category: category || undefined,
        active: active === "all" ? undefined : active === "active",
        page,
        limit: PAGE_SIZE,
      })
      .then((r) => {
        setKits(r.kits);
        setTotal(r.total);
        setCats((c) => [...new Set([...c, ...r.kits.map((k) => k.category).filter(Boolean) as string[]])]);
        setUnsupported(false);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        setLoading(false);
        if ((e as { status?: number }).status === 404) setUnsupported(true);
        else setError(apiErrorMessage(t, e));
      });
  };
  useEffect(load, [debouncedQ, category, active, page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removeKit(k: AdminKit) {
    if (!window.confirm(t("adminKits.deleteConfirm"))) return;
    setDeleting(k.id);
    try {
      await adminKitsApi.remove(k.id);
      toast(t("adminKits.deleted"));
      load();
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setDeleting(null);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (creating || editing) {
    return (
      <div className="screen">
        <button className="btn btn-g" onClick={() => { setCreating(false); setEditing(null); }}>
          {t("common.back")}
        </button>
        <KitForm
          initial={editing ? { kit: editing } : null}
          onDone={() => {
            setCreating(false);
            setEditing(null);
            load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="rowflex">
        <div>
          <h1 style={{ marginBottom: 0 }}>{t("adminKits.title")}</h1>
          <p className="muted tiny">{t("adminKits.sub")}</p>
        </div>
        <span className="spacer" />
        {!unsupported && (
          <button className="btn btn-p" onClick={() => setCreating(true)}>
            {t("adminKits.create")}
          </button>
        )}
      </div>

      {unsupported ? (
        <EmptyState icon={<Icon.box size={32} />} title={t("adminKits.unavailable")} action={
          <button className="btn btn-g" onClick={load}>{t("common.retry")}</button>
        } />
      ) : (
        <>
          <div className="tabrow" role="tablist">
            <button className={`tab${tab === "kits" ? " on" : ""}`} role="tab" aria-selected={tab === "kits"} onClick={() => setTab("kits")}>
              {t("adminKits.title")}
            </button>
            <button className={`tab${tab === "leaderboard" ? " on" : ""}`} role="tab" aria-selected={tab === "leaderboard"} onClick={() => setTab("leaderboard")}>
              {t("p12c.admin.kitLeaderboard.title")}
            </button>
          </div>

      {tab === "leaderboard" ? (
        <KitLeaderboard />
      ) : (
      <>
      <div className="searchbar">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("adminKits.searchPh")}
              aria-label={t("adminKits.searchPh")}
            />
          </div>
          <div className="filterrow">
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label={t("adminKits.category")}>
              <option value="">{t("adminKits.categoryAll")}</option>
              {cats.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={active} onChange={(e) => { setActive(e.target.value as typeof active); setPage(1); }} aria-label={t("adminKits.activeFilter")}>
              <option value="all">{t("adminKits.activeAll")}</option>
              <option value="active">{t("adminKits.activeOnly")}</option>
              <option value="inactive">{t("adminKits.inactiveOnly")}</option>
            </select>
          </div>

          {error && <ErrorCard message={error} onRetry={load} />}
          {loading && <Loading />}

          {!loading && !error && kits.length === 0 && (
            <EmptyState
              icon={<Icon.box size={32} />}
              title={t("adminKits.empty")}
              action={<button className="btn btn-p" onClick={() => setCreating(true)}>{t("adminKits.create")}</button>}
            />
          )}

          {kits.map((k) => (
            <div className="card" key={k.id}>
              <div className="rowflex">
                {k.images?.[0] ? (
                  <img src={k.images[0]} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover" }} />
                ) : (
                  <span style={{ color: "var(--green)" }}><Icon.box size={28} /></span>
                )}
                <div>
                  <b>{k.name_en}</b>
                  <br />
                  <span className="tiny muted">
                    NPR {k.total_npr}
                    {k.category ? ` · ${k.category}` : ""}
                    {` · ${t("adminKits.stock")}: ${k.stock}`}
                  </span>
                  <br />
                  <span className="tiny muted">{parseIncluded(k.whats_included ?? "").slice(0, 3).join(" · ")}</span>
                </div>
                <span className="spacer" />
                <span className={`chip${k.is_active ? "" : " grey"}`}>{k.is_active ? t("admin.on") : t("admin.off")}</span>
              </div>
              <div className="btn-row">
                <button className="btn btn-s" onClick={() => setEditing(k)}>{t("common.edit")}</button>
                <button className="btn btn-g" disabled={deleting === k.id} onClick={() => removeKit(k)}>
                  {deleting === k.id ? t("common.loading") : t("adminKits.delete")}
                </button>
              </div>
            </div>
          ))}

          {pages > 1 && (
            <div className="pager">
              <button className="btn btn-g" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t("common.back")}
              </button>
              <span className="tiny muted">{t("adminKits.page")} {page} {t("adminKits.of")} {pages}</span>
              <button className="btn btn-g" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t("common.next")}
              </button>
            </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
