import { Link } from "react-router-dom";
import { shopApi, meApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../components/ui";
import { useAsync } from "../components/useAsync";
import { Icon } from "../components/icons";
import type { Kit } from "../api/types";

/**
 * U6 — customer wishlist: saved kits with thumbnails, remove buttons,
 * and links back to each kit's product page. Kit names/images come from
 * the item's embedded kit when present, else a listKits() lookup map —
 * never invented.
 */
export default function Wishlist() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(
    () =>
      Promise.all([meApi.listWishlist(), shopApi.listKits()]).then(([w, k]) => ({
        items: w.items,
        kitMap: new Map<string, Kit>(k.kits.map((kit) => [kit.id, kit])),
      })),
    [],
  );

  async function remove(kitId: string) {
    if (!window.confirm(t("p12.customer.removeWishlist"))) return;
    try {
      await meApi.removeFromWishlist(kitId);
      toast(t("p12.customer.wishlistRemoved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  if (loading) return <Loading />;
  const errMsg = error ? apiErrorMessage(t, error) : null;
  if (errMsg) {
    return (
      <div className="screen">
        <ErrorCard message={errMsg} onRetry={retry} />
      </div>
    );
  }

  const items = data?.items ?? [];
  const kitMap = data?.kitMap ?? new Map<string, Kit>();

  return (
    <div className="screen">
      <h1>{t("p12.customer.wishlist")}</h1>

      {items.length === 0 && <EmptyState icon={<Icon.plan size={32} />} title={t("p12.customer.noWishlist")} />}

      {items.map((item) => {
        const kit = item.kit ?? kitMap.get(item.kit_id) ?? null;
        return (
          <div className="card" key={item.kit_id}>
            <div className="rowflex" style={{ alignItems: "center", gap: 12 }}>
              {kit?.images?.[0] ? (
                <img
                  src={kit.images[0]}
                  alt=""
                  style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <span style={{ color: "var(--green)" }}><Icon.box size={40} /></span>
              )}
              <div style={{ flex: 1 }}>
                <b>{kit ? kit.name : item.kit_id.slice(0, 8)}</b>
                {kit && (
                  <>
                    <br />
                    <span className="tiny muted">NPR {kit.total_npr}</span>
                  </>
                )}
              </div>
              <span className="spacer" />
              <Link className="btn btn-s" to={`/kits/${item.kit_id}`} style={{ textDecoration: "none" }}>
                {t("p12.common.view")}
              </Link>
              <button className="btn btn-g btn-s" onClick={() => void remove(item.kit_id)}>
                {t("p12.customer.removeWishlist")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
