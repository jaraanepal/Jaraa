import { useState } from "react";
import { shopApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import type { KitBatch, Order, PackingCheck, Supplier } from "../../api/types";

const HOUR = 3_600_000;

/**
 * Pharmacy batch-2 (008) toolkit: stock history (P10), reorder suggestions
 * (P11), packing checklist (P12), label view (P13), zone stats (P14),
 * order age buckets (P15), duplicate detector (P16), kit batches (P17)
 * and suppliers (P18).
 */
export default function PharmacyTools() {
  const { t } = useLang();
  const K = "p12b.pharmacy";

  // ---- P10 stock movements ----
  const kits = useAsync(() => shopApi.listPharmacyKits().then((r) => r.kits));
  const [movKit, setMovKit] = useState("");
  const [movements, setMovements] = useState<{ id: string; delta: number; reason: string | null; created_at: string }[] | null>(null);
  async function loadMovements() {
    if (!movKit) return;
    try { setMovements((await shopApi.kitMovements(movKit)).movements); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- P11 reorder suggestions ----
  const reorder = useAsync(() => shopApi.reorderSuggestions().then((r) => r.suggestions));

  // ---- P12 packing checklist ----
  const [packOrder, setPackOrder] = useState("");
  const [packing, setPacking] = useState<PackingCheck[] | null>(null);
  const [newStep, setNewStep] = useState("");
  async function loadPacking() {
    if (!packOrder.trim()) return;
    try { setPacking((await shopApi.getPacking(packOrder.trim())).checks); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function toggleStep(c: PackingCheck) {
    try {
      const updated = await shopApi.setPackingStep(c.order_id, c.step, !c.done);
      setPacking((v) => v && v.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function addStep() {
    if (!packOrder.trim() || !newStep.trim()) return;
    try {
      const c = await shopApi.setPackingStep(packOrder.trim(), newStep.trim(), false);
      setPacking((v) => (v ? [...v, c] : [c]));
      setNewStep("");
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- P13 label ----
  const [labelOrder, setLabelOrder] = useState("");
  const [label, setLabel] = useState<{ order: Order; items: { kit_id: string; name: string; qty: number }[] } | null>(null);
  async function loadLabel() {
    if (!labelOrder.trim()) return;
    try { setLabel((await shopApi.orderLabel(labelOrder.trim())).label); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- P14 zones / P15 age buckets / P16 duplicates ----
  const zones = useAsync(() => shopApi.zoneStats().then((r) => r.zones));
  const queue = useAsync(() => shopApi.pharmacyOrders().then((r) => r.orders));
  const dups = useAsync(() => shopApi.duplicateOrders().then((r) => r.duplicates));
  const [ageFilter, setAgeFilter] = useState<"all" | "fresh" | "day" | "old">("all");
  const now = Date.now();
  const ageOk = (o: Order) => {
    if (ageFilter === "all") return true;
    const age = now - Date.parse(o.created_at);
    if (ageFilter === "fresh") return age < 24 * HOUR;
    if (ageFilter === "day") return age >= 24 * HOUR && age < 48 * HOUR;
    return age >= 48 * HOUR;
  };

  // ---- P17 batches ----
  const batches = useAsync(() => shopApi.listBatches().then((r) => r.batches));
  const [bKit, setBKit] = useState("");
  const [bNo, setBNo] = useState("");
  const [bExp, setBExp] = useState("");
  const [bQty, setBQty] = useState("0");
  // P17: inline batch edit (qty + expiry).
  const [editId, setEditId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editExp, setEditExp] = useState("");
  async function addBatch() {
    if (!bKit || !bNo.trim()) return;
    try {
      await shopApi.createBatch({ kit_id: bKit, batch_no: bNo.trim(), expires_on: bExp || undefined, qty: parseInt(bQty, 10) || 0 });
      setBNo(""); setBExp(""); setBQty("0");
      batches.retry();
      toast(t(`${K}.batchSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function saveBatchEdit(b: KitBatch) {
    const qty = parseInt(editQty, 10);
    if (!Number.isInteger(qty) || qty < 0) { toast(t(`${K}.qtyInvalid`)); return; }
    try {
      await shopApi.updateBatch(b.id, { qty, expires_on: editExp || null });
      setEditId(null);
      batches.retry();
      toast(t(`${K}.batchSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function removeBatch(b: KitBatch) {
    if (!window.confirm(t(`${K}.deleteConfirm`, { name: b.batch_no }))) return;
    try { await shopApi.deleteBatch(b.id); batches.retry(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- P18 suppliers ----
  const suppliers = useAsync(() => shopApi.listSuppliers().then((r) => r.suppliers));
  const [sName, setSName] = useState("");
  const [sPhone, setSPhone] = useState("");
  async function addSupplier() {
    if (!sName.trim()) return;
    try {
      await shopApi.createSupplier({ name: sName.trim(), phone: sPhone.trim() || undefined });
      setSName(""); setSPhone("");
      suppliers.retry();
      toast(t(`${K}.supplierSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function removeSupplier(s: Supplier) {
    if (!window.confirm(t(`${K}.deleteConfirm`, { name: s.name }))) return;
    try { await shopApi.deleteSupplier(s.id); suppliers.retry(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  return (
    <div className="page">
      <h1>{t(`${K}.title`)}</h1>

      {/* P11 reorder suggestions */}
      <section>
        <h2>{t(`${K}.reorder`)}</h2>
        {reorder.error ? <ErrorCard message={apiErrorMessage(t, reorder.error)} onRetry={reorder.retry} /> : null}
        {reorder.data && reorder.data.length === 0 && <EmptyState title={t(`${K}.noReorder`)} />}
        {reorder.data && reorder.data.length > 0 && (
          <ul className="list">
            {reorder.data.map(({ kit, threshold }) => (
              <li key={kit.id} className="listrow">
                <div><strong>{kit.name}</strong><p className="muted">{t(`${K}.stockLine`, { stock: kit.stock ?? 0, threshold })}</p></div>
                <span className="chip warn">{t(`${K}.low`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* P10 stock history */}
      <section>
        <h2>{t(`${K}.movements`)}</h2>
        <div className="formrow inline">
          <select value={movKit} onChange={(e) => setMovKit(e.target.value)} aria-label={t(`${K}.kit`)}>
            <option value="">{t(`${K}.pickKit`)}</option>
            {(kits.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <button className="btn" disabled={!movKit} onClick={loadMovements}>{t(`${K}.load`)}</button>
        </div>
        {movements && movements.length === 0 && <EmptyState title={t(`${K}.noMovements`)} />}
        {movements && movements.length > 0 && (
          <ul className="list">
            {movements.map((m) => (
              <li key={m.id} className="listrow">
                <div>
                  <strong className={m.delta >= 0 ? "" : "warn"}>{m.delta >= 0 ? "+" : ""}{m.delta}</strong>
                  <p className="muted">{m.reason ?? "—"} · {m.created_at.slice(0, 16).replace("T", " ")}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* P15 age buckets */}
      <section>
        <h2>{t(`${K}.queue`)}</h2>
        <div className="chiprow" role="group" aria-label={t(`${K}.ageFilter`)}>
          {(["all", "fresh", "day", "old"] as const).map((f) => (
            <button key={f} type="button" className={`chip${ageFilter === f ? " active" : ""}`} onClick={() => setAgeFilter(f)}>
              {t(`${K}.age.${f}`)}
            </button>
          ))}
        </div>
        {queue.error ? <ErrorCard message={apiErrorMessage(t, queue.error)} onRetry={queue.retry} /> : null}
        {queue.data && (
          <ul className="list">
            {queue.data.filter(ageOk).slice(0, 50).map((o) => (
              <li key={o.id} className="listrow">
                <div>
                  <strong><code>{o.id}</code></strong>{" "}
                  <span className="chip">{o.status}</span>
                  <p className="muted">{o.created_at.slice(0, 16).replace("T", " ")}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* P16 duplicates */}
      <section>
        <h2>{t(`${K}.duplicates`)}</h2>
        {dups.error ? <ErrorCard message={apiErrorMessage(t, dups.error)} onRetry={dups.retry} /> : null}
        {dups.data && dups.data.length === 0 && <EmptyState title={t(`${K}.noDuplicates`)} />}
        {dups.data && dups.data.length > 0 && (
          <ul className="list">
            {dups.data.map((o) => (
              <li key={o.id} className="listrow">
                <div><strong><code>{o.id}</code></strong><p className="muted">{o.created_at.slice(0, 16).replace("T", " ")}</p></div>
                <span className="chip warn">{t(`${K}.dupFlag`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* P12 packing checklist */}
      <section>
        <h2>{t(`${K}.packing`)}</h2>
        <div className="formrow inline">
          <input value={packOrder} onChange={(e) => setPackOrder(e.target.value)} placeholder={t(`${K}.orderIdPh`)} />
          <button className="btn" disabled={!packOrder.trim()} onClick={loadPacking}>{t(`${K}.load`)}</button>
        </div>
        {packing && packing.map((c) => (
          <label className="rowflex" key={c.id} style={{ margin: "8px 0" }}>
            <input type="checkbox" checked={c.done} onChange={() => toggleStep(c)} style={{ width: 28, height: 28, minHeight: 28 }} />
            <span>{c.step}</span>
          </label>
        ))}
        <div className="formrow inline">
          <input value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder={t(`${K}.stepPh`)} maxLength={60} />
          <button className="btn" disabled={!packOrder.trim() || !newStep.trim()} onClick={addStep}>{t("common.add")}</button>
        </div>
      </section>

      {/* P13 label */}
      <section>
        <h2>{t(`${K}.label`)}</h2>
        <div className="formrow inline">
          <input value={labelOrder} onChange={(e) => setLabelOrder(e.target.value)} placeholder={t(`${K}.orderIdPh`)} />
          <button className="btn" disabled={!labelOrder.trim()} onClick={loadLabel}>{t(`${K}.load`)}</button>
        </div>
        {label && (
          <div className="card">
            <p><strong>{t(`${K}.labelOrder`)}</strong> <code>{label.order.id}</code></p>
            {label.items.map((i) => <p key={i.kit_id}>{i.name} × {i.qty}</p>)}
            {label.order.delivery_instructions && (
              <p><strong>{t(`${K}.deliveryInstructions`)}:</strong> {label.order.delivery_instructions}</p>
            )}
            <pre className="tiny">{JSON.stringify(label.order.shipping_address, null, 1)}</pre>
            <button className="btn" onClick={() => window.print()}>{t(`${K}.print`)}</button>
          </div>
        )}
      </section>

      {/* P14 zones */}
      <section>
        <h2>{t(`${K}.zones`)}</h2>
        {zones.error ? <ErrorCard message={apiErrorMessage(t, zones.error)} onRetry={zones.retry} /> : null}
        {zones.data && zones.data.length === 0 && <EmptyState title={t(`${K}.noZones`)} />}
        {zones.data && zones.data.length > 0 && (
          <div className="statgrid">
            {zones.data.map((z) => (
              <StatCard key={z.zone} label={z.zone} value={String(z.orders)} />
            ))}
          </div>
        )}
      </section>

      {/* P17 batches */}
      <section>
        <h2>{t(`${K}.batches`)}</h2>
        <div className="formrow inline">
          <select value={bKit} onChange={(e) => setBKit(e.target.value)} aria-label={t(`${K}.kit`)}>
            <option value="">{t(`${K}.pickKit`)}</option>
            {(kits.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <input value={bNo} onChange={(e) => setBNo(e.target.value)} placeholder={t(`${K}.batchNoPh`)} maxLength={120} />
          <input type="date" value={bExp} onChange={(e) => setBExp(e.target.value)} aria-label={t(`${K}.expiry`)} />
          <input value={bQty} onChange={(e) => setBQty(e.target.value)} inputMode="numeric" style={{ width: 80 }} aria-label={t(`${K}.qty`)} />
          <button className="btn" disabled={!bKit || !bNo.trim()} onClick={addBatch}>{t("common.add")}</button>
        </div>
        {batches.error ? <ErrorCard message={apiErrorMessage(t, batches.error)} onRetry={batches.retry} /> : null}
        {batches.data && (
          <ul className="list">
            {batches.data.map((b) => (
              <li key={b.id} className="listrow">
                <div>
                  <strong><code>{b.batch_no}</code></strong>{" "}
                  <span className="muted">{b.kit_name ?? ""} · {t(`${K}.qty`)}: {b.qty}{b.expires_on ? ` · ${t(`${K}.expiry`)}: ${b.expires_on}` : ""}</span>
                  {editId === b.id && (
                    <div className="formrow inline" style={{ marginTop: 8 }}>
                      <input value={editQty} onChange={(e) => setEditQty(e.target.value)} inputMode="numeric" style={{ width: 80 }} aria-label={t(`${K}.qty`)} />
                      <input type="date" value={editExp} onChange={(e) => setEditExp(e.target.value)} aria-label={t(`${K}.expiry`)} />
                      <button className="btn small" onClick={() => saveBatchEdit(b)}>{t("common.save")}</button>
                      <button className="btn small btn-g" onClick={() => setEditId(null)}>{t("common.cancel")}</button>
                    </div>
                  )}
                </div>
                <div className="rowflex">
                  {editId !== b.id && (
                    <button className="btn small" onClick={() => { setEditId(b.id); setEditQty(String(b.qty)); setEditExp(b.expires_on ?? ""); }}>{t("common.edit")}</button>
                  )}
                  <button className="btn small danger" onClick={() => removeBatch(b)}>{t("common.delete")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* P18 suppliers */}
      <section>
        <h2>{t(`${K}.suppliers`)}</h2>
        <div className="formrow inline">
          <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder={t(`${K}.supplierNamePh`)} maxLength={200} />
          <input value={sPhone} onChange={(e) => setSPhone(e.target.value)} placeholder={t(`${K}.phonePh`)} maxLength={40} />
          <button className="btn" disabled={!sName.trim()} onClick={addSupplier}>{t("common.add")}</button>
        </div>
        {suppliers.error ? <ErrorCard message={apiErrorMessage(t, suppliers.error)} onRetry={suppliers.retry} /> : null}
        {suppliers.data && (
          <ul className="list">
            {suppliers.data.map((s) => (
              <li key={s.id} className="listrow">
                <div><strong>{s.name}</strong><p className="muted">{s.phone ?? "—"}</p></div>
                <button className="btn small danger" onClick={() => removeSupplier(s)}>{t("common.delete")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
