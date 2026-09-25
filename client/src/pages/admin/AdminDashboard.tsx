import { Link } from "react-router-dom";
import { useState } from "react";
import { adminApi, adminKitsApi, doctorApi, shopApi } from "../../api/client";
import { adminB3Api, type CommunityTip } from "../../api/b3admin";
import {
  opsDigest, adminNotices, markAdminNoticeRead, referralStats,
  challengeAnalytics, emailLogs, ticketSla,
  type OpsDigest, type AdminNotice, type ChallengeAnalyticsRow, type EmailLog,
} from "../../api/b4admin";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/** A23 — pending community tips with approve/reject; refreshes after each decision. */
function ModerationQueue() {
  const { t } = useLang();
  const [tips, setTips] = useState<CommunityTip[] | null>(null);
  const { data, error, loading, retry } = useAsync(() =>
    adminB3Api.moderationQueue().then((r) => r.tips),
  );
  const shown = tips ?? data;
  const errMsg = error ? apiErrorMessage(t, error) : null;

  async function decide(tip: CommunityTip, approved: boolean) {
    try {
      await adminB3Api.decideTip(tip.id, approved);
      setTips((p) => (p ?? data ?? []).filter((x) => x.id !== tip.id));
      toast(t(approved ? "p12c.admin.moderation.approveSuccess" : "p12c.admin.moderation.rejectSuccess"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  if (loading) return <Loading />;
  if (errMsg) return <ErrorCard message={errMsg} onRetry={retry} />;
  if (!shown || shown.length === 0)
    return <EmptyState icon={<Icon.doc size={32} />} title={t("p12c.admin.moderation.empty")} />;

  return (
    <div>
      {shown.map((tip) => (
        <div className="card" key={tip.id}>
          <b>{tip.title}</b>
          <p className="tiny muted" style={{ marginBottom: 8 }}>{tip.body}</p>
          <div className="btn-row">
            <button className="btn btn-s" onClick={() => decide(tip, true)}>
              {t("p12c.admin.moderation.approve")}
            </button>
            <button className="btn btn-g" onClick={() => decide(tip, false)}>
              {t("p12c.admin.moderation.reject")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function todayCount(dates: string[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return dates.filter((d) => d.slice(0, 10) === today).length;
}

/* ---------------- Batch 4 (A30–A47) widgets ---------------- */
const K4 = "p12d.admin";

/** A47 — morning ops digest stat cards. */
function OpsDigestCard() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => opsDigest().then((r) => r.digest));
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  if (!data) return null;
  const d: OpsDigest = data;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.digest.title`)}</h3>
      <div className="statgrid">
        <StatCard label={t(`${K4}.digest.ordersToday`)} value={String(d.ordersToday)} icon={<Icon.box size={26} />} />
        <StatCard label={t(`${K4}.digest.slaBreaches`)} value={String(d.slaBreaches)} icon={<Icon.alert size={26} />} />
        <StatCard label={t(`${K4}.digest.openTickets`)} value={String(d.openTickets)} icon={<Icon.doc size={26} />} />
        <StatCard label={t(`${K4}.digest.pendingRefunds`)} value={String(d.pendingRefunds)} icon={<Icon.truck size={26} />} />
      </div>
      <p className="tiny muted">{t(`${K4}.digest.updated`)}</p>
    </div>
  );
}

/** A44 — internal admin notices with per-admin read flags. */
function AdminNoticeBell() {
  const { t } = useLang();
  const [notices, setNotices] = useState<AdminNotice[] | null>(null);
  const { data, error, loading, retry } = useAsync(() => adminNotices().then((r) => r.notices));
  const shown = notices ?? data;
  const unread = (shown ?? []).filter((n) => !n.read).length;

  async function markRead(n: AdminNotice) {
    try {
      await markAdminNoticeRead(n.id);
      setNotices((p) => (p ?? shown ?? []).map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        🔔 {t(`${K4}.notices.title`)}
        {unread > 0 && <span className="chip" style={{ marginLeft: 8 }}>{unread} {t(`${K4}.notices.unread`)}</span>}
      </h3>
      {!shown || shown.length === 0 ? (
        <EmptyState icon={<Icon.doc size={32} />} title={t(`${K4}.notices.empty`)} />
      ) : (
        shown.map((n) => (
          <div className="listrow" key={n.id} style={{ opacity: n.read ? 0.65 : 1 }}>
            <div>
              <b>{n.title_en}</b>
              {n.body_en && <p className="tiny muted" style={{ margin: "4px 0 0" }}>{n.body_en.slice(0, 140)}</p>}
              <p className="tiny muted" style={{ margin: "4px 0 0" }}>{n.created_at.slice(0, 16).replace("T", " ")}</p>
            </div>
            <span className="spacer" />
            {!n.read && (
              <button className="btn small" onClick={() => markRead(n)}>{t(`${K4}.notices.markRead`)}</button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** A39 — referral code stats (honest zeros until the feature ships). */
function ReferralCard() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => referralStats().then((r) => r.stats));
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  if (!data) return null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.referrals.title`)}</h3>
      <div className="statgrid">
        <StatCard label={t(`${K4}.referrals.codes`)} value={String(data.codes)} icon={<Icon.user size={26} />} />
        <StatCard label={t(`${K4}.referrals.joined`)} value={String(data.joined)} icon={<Icon.user size={26} />} />
      </div>
      <p className="tiny muted">{t(`${K4}.referrals.note`)}</p>
    </div>
  );
}

/** A40 — challenge assigned/completed analytics. */
function ChallengeAnalytics() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => challengeAnalytics().then((r) => r.challenges));
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const rows: ChallengeAnalyticsRow[] = data ?? [];
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.challenges.title`)}</h3>
      {rows.length === 0 ? (
        <EmptyState icon={<Icon.doc size={32} />} title={t(`${K4}.challenges.empty`)} />
      ) : (
        <table className="tiny" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t(`${K4}.challenges.title`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.challenges.assigned`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.challenges.completed`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.challenges.rate`)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.challenge_id}>
                <td>{c.title_en}</td>
                <td style={{ textAlign: "right" }}>{c.assigned}</td>
                <td style={{ textAlign: "right" }}>{c.completed}</td>
                <td style={{ textAlign: "right" }}>
                  <b>{c.assigned > 0 ? `${Math.round((c.completed / c.assigned) * 100)}%` : "—"}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A37 — email delivery log. */
function EmailLogList() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => emailLogs(50).then((r) => r.logs));
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const rows: EmailLog[] = data ?? [];
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.emailLogs.title`)}</h3>
      {rows.length === 0 ? (
        <EmptyState icon={<Icon.doc size={32} />} title={t(`${K4}.emailLogs.empty`)} />
      ) : (
        rows.map((l) => (
          <div className="listrow" key={l.id}>
            <div>
              <b>{l.template}</b> → {l.to_email}
              <br />
              <span className="tiny muted">
                {l.created_at.slice(0, 16).replace("T", " ")}
                {l.error && ` · ${t(`${K4}.emailLogs.error`)}: ${l.error.slice(0, 120)}`}
              </span>
            </div>
            <span className="spacer" />
            <span className={`chip${l.status === "sent" ? "" : " muted"}`}>{t(`${K4}.emailLogs.${l.status}`)}</span>
          </div>
        ))
      )}
    </div>
  );
}

/** A34 — ticket SLA summary card. */
function TicketSlaCard() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => ticketSla().then((r) => r.sla));
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  if (!data) return null;
  const mins = (v: number | null) => (v === null ? t(`${K4}.ticketSla.untracked`) : `${v} ${t(`${K4}.ticketSla.minutes`)}`);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.ticketSla.title`)}</h3>
      <div className="statgrid">
        <StatCard label={t(`${K4}.ticketSla.open`)} value={String(data.open)} icon={<Icon.doc size={26} />} />
      </div>
      <p className="tiny">
        <b>{t(`${K4}.ticketSla.avgFirstResponse`)}:</b> {mins(data.avgFirstResponseMin)}
        {" · "}
        <b>{t(`${K4}.ticketSla.avgResolution`)}:</b> {mins(data.avgResolveMin)}
      </p>
    </div>
  );
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
  // A25 — scan photo quality pass rates per angle.
  const scanQuality = useAsync(() => adminB3Api.scanQuality().then((r) => r.stats));

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

          <h3>{t("p12c.admin.moderation.title")} — {t("p12c.admin.moderation.queue")}</h3>
          <ModerationQueue />

          {scanQuality.data && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t("p12c.admin.scanQuality.title")}</h3>
              {scanQuality.data.length === 0 ? (
                <p className="tiny muted">—</p>
              ) : (
                <table className="tiny" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>{t("p12c.admin.scanQuality.angle")}</th>
                      <th style={{ textAlign: "right" }}>{t("p12c.admin.scanQuality.passed")}</th>
                      <th style={{ textAlign: "right" }}>{t("p12c.admin.scanQuality.total")}</th>
                      <th style={{ textAlign: "right" }}>{t("p12c.admin.scanQuality.passRate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanQuality.data.map((s) => (
                      <tr key={s.angle}>
                        <td>{s.angle}</td>
                        <td style={{ textAlign: "right" }}>{s.passed}</td>
                        <td style={{ textAlign: "right" }}>{s.total}</td>
                        <td style={{ textAlign: "right" }}>
                          <b>{s.total > 0 ? `${Math.round((s.passed / s.total) * 100)}%` : "—"}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="tiny muted">{t("p12c.admin.scanQuality.note")}</p>
            </div>
          )}

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

          <OpsDigestCard />
          <AdminNoticeBell />
          <TicketSlaCard />
          <ReferralCard />
          <ChallengeAnalytics />
          <EmailLogList />
        </>
      )}
    </div>
  );
}
