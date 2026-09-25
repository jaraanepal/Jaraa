import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { shopApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, apiErrorMessage } from "../components/ui";
import { Icon } from "../components/icons";
import type { Kit } from "../api/types";

export default function Kits() {
  const { t } = useLang();
  const [kits, setKits] = useState<Kit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <Loading />;

  return (
    <div className="screen">
      <h1>{t("kits.title")}</h1>
      {error && <ErrorCard message={error} />}
      {kits.length === 0 && !error && <p className="muted">{t("kits.empty")}</p>}

      {kits.map((kit) => {
        // Prescription items are never listed while prescription commerce is OFF.
        const cosmetic = kit.products.filter((p) => p.kind === "cosmetic");
        const thumb = (kit.images ?? [])[0];
        return (
          <Link to={`/kits/${kit.id}`} key={kit.id} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card">
              <div className="rowflex">
                {thumb ? (
                  <img
                    src={thumb}
                    alt={kit.name}
                    style={{ width: 72, height: 72, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <span style={{ color: "var(--green)", flexShrink: 0 }}><Icon.box size={48} /></span>
                )}
                <div style={{ minWidth: 0 }}>
                  <b>{kit.name}</b>
                  {kit.description && <><br /><span className="tiny muted">{kit.description}</span></>}
                  <br />
                  <span className="tiny muted">{cosmetic.map((p) => p.name).join(" • ")}</span>
                  <br />
                  <b style={{ color: "var(--green)" }}>NPR {kit.total_npr}</b>
                </div>
                <span className="spacer" />
                <span className="linklike" style={{ flexShrink: 0 }}>{t("kits.viewDetails")}</span>
              </div>
            </div>
          </Link>
        );
      })}

      <p className="tiny muted">{t("kits.cosmeticOnly")}</p>
      <div className="center">
        <Link className="linklike" to="/orders">{t("orders.title")}</Link>
      </div>
    </div>
  );
}
