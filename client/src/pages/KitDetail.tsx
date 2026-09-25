import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { meApi, shopApi } from "../api/client";
import { customerB3Api } from "../api/b3customer";
import { useAuth } from "../auth/AuthContext";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, Modal, apiErrorMessage, toast } from "../components/ui";
import { Icon } from "../components/icons";
import { GiftCheckoutFields } from "../components/b3customer";
import { isValidNpPhone, normalizeNpPhone } from "../lib/phone";
import type { Address, Kit } from "../api/types";

type PayMethod = "cod" | "esewa" | "khalti";

export default function KitDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLang();
  const { isAuthed, isGuest } = useAuth();
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
  // P10: saved addresses — selectable cards so the user doesn't retype.
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [addrLoading, setAddrLoading] = useState(false);
  const [selectedAddrId, setSelectedAddrId] = useState<string | null>(null);
  const [useNew, setUseNew] = useState(true);
  // U6: wishlist state for this kit.
  const [wishlisted, setWishlisted] = useState<boolean | null>(null);

  // U6: check whether this kit is already on the wishlist (signed-in only).
  useEffect(() => {
    if (!id || !isAuthed || isGuest) return;
    meApi
      .listWishlist()
      .then((r) => setWishlisted(r.items.some((i) => i.kit_id === id)))
      .catch(() => setWishlisted(null));
  }, [id, isAuthed, isGuest]);

  async function toggleWishlist() {
    if (!id || wishlisted === null) return;
    try {
      if (wishlisted) {
        await meApi.removeFromWishlist(id);
        setWishlisted(false);
        toast(t("p12.customer.wishlistRemoved"));
      } else {
        await meApi.addToWishlist(id);
        setWishlisted(true);
        toast(t("p12.customer.wishlistAdded"));
      }
    } catch (e) {
      setError(apiErrorMessage(t, e));
    }
  }

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

  // U19: delivery instructions prefilled from the profile.
  const [deliveryNote, setDeliveryNote] = useState("");
  // A16: coupon code applied at checkout (server validates + discounts).
  const [couponCode, setCouponCode] = useState("");
  // U26: gift-a-kit — client-only; server stores the fields via the order endpoint (shop track).
  const [gift, setGift] = useState({ isGift: false, name: "", phone: "", message: "" });
  useEffect(() => {
    if (!checkoutOpen || !isAuthed || isGuest) return;
    meApi.getProfile().then((p) => {
      setDeliveryNote(p.delivery_instructions ?? "");
      // U46 (batch 4): prefill the saved default payment method.
      const dp = (p as { default_payment?: string | null }).default_payment;
      if (dp === "esewa" || dp === "khalti" || dp === "cod") setPay(dp);
    }).catch(() => {});
  }, [checkoutOpen, isAuthed, isGuest]);

  // P10: when the checkout modal opens for a signed-in (non-guest) user,
  // load their saved addresses so they can pick one instead of retyping.
  useEffect(() => {
    if (!checkoutOpen || !isAuthed || isGuest) return;
    setAddrLoading(true);
    meApi
      .listAddresses()
      .then((r) => {
        const addrs = r.addresses ?? [];
        setSavedAddresses(addrs);
        if (addrs.length > 0) {
          const def = addrs.find((a) => a.is_default) ?? addrs[0];
          setSelectedAddrId(def.id);
          setUseNew(false);
        } else {
          setUseNew(true);
        }
      })
      .catch(() => {
        // Address fetch failed — fall back to the manual form.
        setUseNew(true);
      })
      .finally(() => setAddrLoading(false));
  }, [checkoutOpen, isAuthed, isGuest]);

  async function placeOrder() {
    if (!kit) return;
    // P10: a selected saved address fills the payload; otherwise the manual form.
    const chosen = !useNew ? savedAddresses.find((a) => a.id === selectedAddrId) : null;
    const shipName = chosen ? chosen.name : name.trim();
    // P-14: normalize saved phones ("+977-98..." etc.) to the 10-digit form.
    const shipPhone = normalizeNpPhone(chosen ? chosen.phone : phone.trim());
    const shipCity = chosen ? chosen.city : city.trim();
    const shipLine = chosen ? chosen.address_line : address.trim();
    if (!shipName || !shipLine || !shipCity) {
      setError(t("checkout.invalid"));
      return;
    }
    if (!isValidNpPhone(shipPhone)) {
      setError(t("checkout.invalidPhone"));
      return;
    }
    // U26: gift fields ride on the order payload (server validates + stores).
    const giftPayload = gift.isGift && gift.name.trim()
      ? customerB3Api.toGiftPayload({
          recipient_name: gift.name.trim(),
          recipient_phone: gift.phone.replace(/\D/g, ""),
          message: gift.message.trim(),
        })
      : {};
    if (gift.isGift && !gift.name.trim()) {
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
          shipping_address: { name: shipName, phone: shipPhone, city: shipCity, address_line: shipLine },
          delivery_instructions: deliveryNote.trim() || undefined,
          coupon_code: couponCode.trim() || undefined,
          ...giftPayload,
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
    setSavedAddresses([]);
    setSelectedAddrId(null);
    setUseNew(true);
    setGift({ isGift: false, name: "", phone: "", message: "" });
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
      {/* U6: wishlist toggle (signed-in customers only) */}
      {isAuthed && !isGuest && wishlisted !== null && (
        <button className="btn btn-g" onClick={toggleWishlist} style={{ marginTop: 8 }}>
          {wishlisted ? t("p12.customer.removeWishlist") : t("p12.customer.addWishlist")}
        </button>
      )}
      <p className="tiny muted center">{t("kits.cosmeticOnly")}</p>

      {checkoutOpen && (
        <Modal onClose={closeCheckout}>
          {!orderId ? (
            <>
              <h2>{t("checkout.title")}</h2>
              <p className="muted">{kit.name} — <b>NPR {kit.total_npr}</b></p>
              {error && <ErrorCard message={error} />}

              {/* P10: saved addresses — pick one instead of retyping. */}
              {addrLoading && <p className="muted tiny">{t("common.loading")}</p>}
              {!addrLoading && savedAddresses.length > 0 && (
                <>
                  <label className="fl">{t("checkout.savedAddresses")}</label>
                  {savedAddresses.map((a) => (
                    <label
                      key={a.id}
                      className="addr-card"
                      style={{
                        display: "flex", gap: 10, alignItems: "flex-start",
                        borderColor: !useNew && selectedAddrId === a.id ? "var(--green)" : undefined,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="co-addr"
                        checked={!useNew && selectedAddrId === a.id}
                        onChange={() => { setSelectedAddrId(a.id); setUseNew(false); }}
                        style={{ width: 22, height: 22, minHeight: 22, marginTop: 2, flex: "none" }}
                      />
                      <span>
                        <b>{a.name}</b> · {a.phone}
                        {a.is_default && <span className="chip">{t("profile.defaultAddr")}</span>}
                        <br />
                        <span className="tiny muted">
                          {a.label ? `${a.label} — ` : ""}{a.address_line}, {a.city}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label
                    className="addr-card"
                    style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}
                  >
                    <input
                      type="radio"
                      name="co-addr"
                      checked={useNew}
                      onChange={() => setUseNew(true)}
                      style={{ width: 22, height: 22, minHeight: 22, flex: "none" }}
                    />
                    <span><b>{t("checkout.useNewAddress")}</b></span>
                  </label>
                </>
              )}

              {(useNew || savedAddresses.length === 0) && (
                <>
                  <label className="fl" htmlFor="co-name">{t("checkout.name")}</label>
                  <input id="co-name" type="text" placeholder={t("checkout.namePh")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  <label className="fl" htmlFor="co-phone">{t("checkout.phone")}</label>
                  <input id="co-phone" type="tel" inputMode="numeric" placeholder={t("login.phonePlaceholder")} value={phone} maxLength={10} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} autoComplete="tel" />
                  <label className="fl" htmlFor="co-city">{t("checkout.address")}</label>
                  <input id="co-city" type="text" placeholder={t("checkout.addressPh")} value={city} onChange={(e) => setCity(e.target.value)} />
                  <input type="text" placeholder={t("checkout.addressPh")} value={address} onChange={(e) => setAddress(e.target.value)} aria-label={t("checkout.address")} />
                </>
              )}
              <label className="fl" htmlFor="co-deliv">{t("p12b.customer.delivery")}</label>
              <textarea id="co-deliv" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder={t("p12b.customer.deliveryPh")} rows={2} maxLength={500} />
              <label className="fl" htmlFor="co-coupon">{t("p12b.customer.coupon")}</label>
              <input id="co-coupon" type="text" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder={t("p12b.customer.couponPh")} maxLength={24} autoComplete="off" />
              {/* U26: send this order as a gift */}
              <GiftCheckoutFields value={gift} onChange={setGift} />
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
