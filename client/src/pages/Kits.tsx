import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { shopApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, Modal, apiErrorMessage, toast } from "../components/ui";
import { Icon } from "../components/icons";
import type { Kit } from "../api/types";

type PayMethod = "cod" | "esewa" | "khalti";

export default function Kits() {
  const { t } = useLang();
  const [kits, setKits] = useState<Kit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Kit | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [pay, setPay] = useState<PayMethod>("cod");
  const [paying, setPaying] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    shopApi
      .listKits()
      .then((r) => {
        setKits(r.kits);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  }, [t]);

  async function placeOrder() {
    if (!open) return;
    if (!name.trim() || !/^9\d{9}$/.test(phone.trim()) || !address.trim()) {
      setError(t("checkout.invalid"));
      return;
    }
    setPaying(true);
    setError(null);
    try {
      const order = await shopApi.createOrder(
        {
          kit_id: open.id,
          payment_method: pay,
          shipping_address: { name: name.trim(), phone: phone.trim(), city: city.trim(), address_line: address.trim() },
        },
        crypto.randomUUID(),
      );
      setOrderId(order.id);
      toast(t("orderok.title"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setPaying(false);
    }
  }

  function close() {
    setOpen(null);
    setOrderId(null);
    setError(null);
  }

  if (loading) return <Loading />;

  return (
    <div className="screen">
      <h1>{t("kits.title")}</h1>
      {error && !open && <ErrorCard message={error} />}
      {kits.length === 0 && !error && <p className="muted">{t("kits.empty")}</p>}

      {kits.map((kit) => {
        // Prescription items are never listed while prescription commerce is OFF.
        const cosmetic = kit.products.filter((p) => p.kind === "cosmetic");
        return (
          <div className="card" key={kit.id}>
            <div className="rowflex">
              <span style={{ color: "var(--green)" }}><Icon.box size={28} /></span>
              <div>
                <b>{kit.name}</b>
                {kit.description && <><br /><span className="tiny muted">{kit.description}</span></>}
                <br />
                <span className="tiny muted">{cosmetic.map((p) => p.name).join(" • ")}</span>
                <br />
                <b style={{ color: "var(--green)" }}>NPR {kit.total_npr}</b>
              </div>
              <span className="spacer" />
              <button className="btn btn-p" style={{ width: "auto", margin: 0 }} onClick={() => setOpen(kit)}>
                {t("kits.buyNow")}
              </button>
            </div>
          </div>
        );
      })}

      <p className="tiny muted">{t("kits.cosmeticOnly")}</p>
      <div className="center">
        <Link className="linklike" to="/orders">{t("orders.title")}</Link>
      </div>

      {open && (
        <Modal onClose={close}>
          {!orderId ? (
            <>
              <h2>{t("checkout.title")}</h2>
              <p className="muted">{open.name} — <b>NPR {open.total_npr}</b></p>
              {error && <ErrorCard message={error} />}
              <label className="fl" htmlFor="co-name">{t("checkout.name")}</label>
              <input id="co-name" type="text" placeholder={t("checkout.namePh")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              <label className="fl" htmlFor="co-phone">{t("checkout.phone")}</label>
              <input id="co-phone" type="tel" inputMode="numeric" placeholder={t("login.phonePlaceholder")} value={phone} maxLength={10} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} autoComplete="tel" />
              <label className="fl" htmlFor="co-city">{t("checkout.address")}</label>
              <input id="co-city" type="text" placeholder={t("checkout.addressPh")} value={city} onChange={(e) => setCity(e.target.value)} />
              <input type="text" placeholder={t("checkout.addressPh")} value={address} onChange={(e) => setAddress(e.target.value)} aria-label={t("checkout.address")} />
              <label className="fl" htmlFor="co-pay">{t("checkout.paymentMethod")}</label>
              <select id="co-pay" value={pay} onChange={(e) => setPay(e.target.value as PayMethod)}>
                <option value="cod">{t("checkout.cod")}</option>
                <option value="esewa">{t("checkout.esewa")}</option>
                <option value="khalti">{t("checkout.khalti")}</option>
              </select>
              <p className="tiny muted">{t("checkout.deliveryNote")}</p>
              <button className="btn btn-p" disabled={paying} onClick={placeOrder}>
                {paying ? t("common.loading") : t("checkout.placeOrder", { total: open.total_npr })}
              </button>
            </>
          ) : (
            <div className="center">
              <div style={{ color: "var(--green)" }}><Icon.check size={48} /></div>
              <h2>{t("orderok.title")}</h2>
              <p>{t("orderok.orderId")} <span className="kbd">{orderId.slice(0, 8)}</span></p>
              <p className="tiny muted">{t("orderok.packing")}</p>
              <Link className="btn btn-p" to="/orders" style={{ textDecoration: "none", textAlign: "center" }}>
                {t("orderok.trackInOrders")}
              </Link>
              <br />
              <button className="linklike" onClick={close}>{t("kits.backToMap")}</button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
