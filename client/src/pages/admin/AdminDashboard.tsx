import { Link } from "react-router-dom";
import { adminApi, adminKitsApi, doctorApi, shopApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, StatCard, apiErrorMessage } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

function todayCount(dates: string[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return dates.filter((d) => d.slice(0, 10) === today).length;
}

/** Landing page for admins: stat cards from real endpoints + recent audit activity. */
export default function AdminDashboard() {
  const { t } = useLang();

  const users = useAsync(() => adminApi.listUsers().then((r) => r.users));
  const orders = useAsync(() => shopApi.pharmacyOrders().then((r) => r.orders));
  const kits = useAsync(() =>
    adminKitsApi
      .list({ limit: 1 })
      .then((r) => ({ total: r.total, kits: r.kits }))
      .catch((e) => {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }),
  );
  const flags = useAsync(() => adminApi.listFlags().then((r) => r.flags));
  const scans = useAsync(() =>
    doctorApi
      .listCases("queued", 1)
      .then((r) => r.cases.length)
      .catch(() => null), // admins may not hold the doctor scope — card hidden then
  );
  const audit = useAsync(() => adminApi.listAudit({ limit: 8 }).then((r) => r.entries));
  const funnel = useAsync(() => adminApi.getFunnel());

  const loading = users.loading || orders.loading || kits.loading || flags.loading || audit.loading;

  const staffCount = users.data?.filter((u) => u.role !== "customer").length ?? 0;

  return (
    <div className="screen">
      <h1>{t("adminDash.title")}</h1>
      <p className="muted tiny">{t("adminDash.sub")}</p>

      {loading && <Loading />}
      {!loading && (
        <>
          <div className="statgrid">
            {users.data && (
              <StatCard label={t("adminDash.totalUsers")} value={String(users.data.length)} icon={<Icon.user size={26} />} />
            )}
            {staffCount > 0 && (
              <StatCard label={t("adminDash.staffCount")} value={String(staffCount)} icon={<Icon.doc size={26} />} />
            )}
            {orders.data && (
              <StatCard
                label={t("adminDash.ordersToday")}
                value={String(todayCount(orders.data.map((o) => o.created_at)))}
                icon={<Icon.truck size={26} />}
              />
            )}
            {kits.data && (
              <StatCard label={t("adminKits.title")} value={String(kits.data.total)} icon={<Icon.box size={26} />} />
            )}
            {flags.data && (
              <StatCard
                label={t("adminDash.flagsOn")}
                value={String(flags.data.filter((f) => f.is_enabled).length)}
                icon={<Icon.alert size={26} />}
              />
            )}
            {scans.data !== null && (
              <StatCard label={t("adminDash.pendingScans")} value={String(scans.data)} icon={<Icon.clock size={26} />} />
            )}
          </div>
          {kits.error && <p className="tiny muted">{t("adminKits.unavailable")}</p>}

          {funnel.data && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t("admin.analyticsTitle")}</h3>
              <p className="tiny">
                <b>{t("admin.slaTitle")}:</b> {t("admin.slaMedian")} {funnel.data.review_sla_hours_median}h
              </p>
              <p className="tiny">
                {t("admin.kitRate")} {(funnel.data.plan_view_to_kit_rate * 100).toFixed(1)}% · {t("admin.rescanRate")}{" "}
                {(funnel.data.rescan_rate_m2 * 100).toFixed(1)}%
              </p>
              <p className="tiny">
                {t("admin.redFlagMisses")} {funnel.data.red_flag_misses}
              </p>
            </div>
          )}

          <h3>{t("dash.manage")}</h3>
          <Link className="dashlink" to="/admin/kits">
            <Icon.box size={20} /> {t("adminKits.title")} <span className="spacer">›</span>
          </Link>
          <Link className="dashlink" to="/admin/orders">
            <Icon.truck size={20} /> {t("adminOrders.title")} <span className="spacer">›</span>
          </Link>
          <Link className="dashlink" to="/admin/users">
            <Icon.user size={20} /> {t("adminUsers.title")} <span className="spacer">›</span>
          </Link>
          <Link className="dashlink" to="/admin/flags">
            <Icon.alert size={20} /> {t("admin.flagsTitle")} <span className="spacer">›</span>
          </Link>
          <Link className="dashlink" to="/admin/audit">
            <Icon.doc size={20} /> {t("admin.auditTitle")} <span className="spacer">›</span>
          </Link>

          <h3>{t("dash.recentActivity")}</h3>
          {audit.error && <ErrorCard message={apiErrorMessage(t, audit.error)} onRetry={audit.retry} />}
          {audit.data && audit.data.length === 0 && (
            <EmptyState icon={<Icon.doc size={32} />} title={t("dash.noActivity")} />
          )}
          {audit.data &&
            audit.data.map((a) => (
              <p key={a.id} className="tiny">
                {a.at.slice(0, 16).replace("T", " ")} — <b>{a.action}</b> — {a.entity}/{a.entity_id.slice(0, 8)} —{" "}
                {a.actor_id.slice(0, 8)}
              </p>
            ))}
        </>
      )}
    </div>
  );
}
