import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { shopApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, Modal, apiErrorMessage, toast } from "../components/ui";
import { Icon } from "../components/icons";
import type { Kit } from "../api/types";

type PayMethod = "cod" | "esewa" | "khalti";

export default function KitDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLang();
  const [kit, setKit] = useState<Kit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeImg, setActiveImg] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [pay, setPay] = useState<PayMethod>("cod");
  const [paying, setPaying] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    shopApi
      .getKit(id)
      .then((k) => {
        setKit(k);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  }, [id, t]);

  async function placeOrder() {
    if (!kit) return;
    if (!name.trim() || !/^9\d{9}$/.test(phone.trim()) || !address.trim()) {
      setError(t("checkout.invalid"));
      return;
    }
    setPaying(true);
    setError(null);
    try {
      const order = await shopApi.createOrder(
        {
          kit_id: kit.id,
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

  function closeCheckout() {
    setCheckoutOpen(false);
    setOrderId(null);
    setError(null);
  }

  if (loading) return <Loading />;
  if (error && !kit) {
    return (
      <div className="screen">
        <ErrorCard message={error} />
        <div className="center"><Link className="linklike" to="/kits">{t("kits.backToKits")}</Link></div>
      </div>
    );
  }
  if (!kit) return null;

  const cosmetic = kit.products.filter((p) => p.kind === "cosmetic");
  const images = kit.images ?? [];
  const outOfStock = (kit.stock ?? 1) <= 0;

  return (
    <div className="screen">
      <div className="center" style={{ marginBottom: 8 }}>
        <Link className="linklike" to="/kits">← {t("kits.backToKits")}</Link>
      </div>

      {/* Image gallery — shows ALL kit images, not just one */}
      {images.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <img
            src={images[activeImg]}
            alt={kit.name}
            style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 14 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          {images.length > 1 && (
            <div className="kitimg-row" style={{ marginTop: 8 }}>
              {images.map((src, i) => (
                <button
                  key={src + i}
                  onClick={() => setActiveImg(i)}
                  style={{
                    border: i === activeImg ? "2px solid var(--green)" : "2px solid transparent",
                    borderRadius: 10,
                    padding: 0,
                    background: "none",
                    cursor: "pointer",
                  }}
                  aria-label={`${t("kitdetail.photo")} ${i + 1}`}
                >
                  <img
                    src={src}
                    alt=""
                    style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", display: "block" }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="card center" style={{ padding: 24 }}>
          <span style={{ color: "var(--green)" }}><Icon.box size={48} /></span>
          <p className="tiny muted">{t("kitdetail.noImage")}</p>
        </div>
      )}

      <h1 style={{ marginBottom: 4 }}>{kit.name}</h1>
      <div className="rowflex" style={{ marginBottom: 8 }}>
        <b style={{ color: "var(--green)", fontSize: 20 }}>NPR {kit.total_npr}</b>
        <span className="spacer" />
        {kit.category && <span className="kbd">{kit.category}</span>}
      </div>
      {outOfStock && <ErrorCard message={t("kitdetail.outOfStock")} />}

      {kit.description && (
        <div className="card">
          <b>{t("kitdetail.about")}</b>
          <p style={{ margin: "6px 0 0" }}>{kit.description}</p>
        </div>
      )}

      {kit.whats_included && (
        <div className="card">
          <b>{t("kitdetail.included")}</b>
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>{kit.whats_included}</p>
        </div>
      )}

      {cosmetic.length > 0 && (
        <div className="card">
          <b>{t("kitdetail.products")}</b>
          {cosmetic.map((p) => (
            <div className="rowflex" key={p.id} style={{ marginTop: 8 }}>
              {p.image_url && (
                <img src={p.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
              <div>
                <b>{p.name}</b>
                <br />
                <span className="tiny muted">NPR {p.price_npr}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {kit.usage_instructions && (
        <div className="card">
          <b>{t("kitdetail.howToUse")}</b>
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>{kit.usage_instructions}</p>
        </div>
      )}

      <button
        className="btn btn-p"
        disabled={outOfStock}
        onClick={() => setCheckoutOpen(true)}
        style={{ marginTop: 12 }}
      >
        {t("kits.buyNow")}
      </button>
      <p className="tiny muted center">{t("kits.cosmeticOnly")}</p>

      {checkoutOpen && (
        <Modal onClose={closeCheckout}>
          {!orderId ? (
            <>
              <h2>{t("checkout.title")}</h2>
              <p className="muted">{kit.name} — <b>NPR {kit.total_npr}</b></p>
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
                {paying ? t("common.loading") : t("checkout.placeOrder", { total: kit.total_npr })}
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
              <button className="linklike" onClick={closeCheckout}>{t("kits.backToMap")}</button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
