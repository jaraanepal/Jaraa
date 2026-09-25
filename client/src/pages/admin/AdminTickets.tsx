import { useState } from "react";
import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import type { SupportTicket, TicketReply } from "../../api/types";

type StatusFilter = "open" | "answered" | "closed" | "";

const STATUS_TONE: Record<Exclude<StatusFilter, "">, "amber" | undefined | "grey"> = {
  open: "amber",
  answered: undefined,
  closed: "grey",
};

/**
 * A7: support ticket inbox — status filter, ticket detail with replies,
 * reply box, close/reopen.
 */
export default function AdminTickets() {
  const { t } = useLang();
  const [status, setStatus] = useState<StatusFilter>("");
  const { data, error, loading, retry } = useAsync(
    () => adminApi.listTickets(status || undefined).then((r) => r.tickets),
    [status],
  );
  const listError = error ? apiErrorMessage(t, error) : null;

  const [active, setActive] = useState<SupportTicket | null>(null);
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);

  const statusLabel = (s: Exclude<StatusFilter, "">) =>
    s === "open" ? t("p12.admin.ticketOpen") : s === "answered" ? t("p12.admin.ticketAnswered") : t("p12.admin.ticketClosed");

  async function openTicket(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    setReplyBody("");
    try {
      const r = await adminApi.getTicket(id);
      setActive(r.ticket);
      setReplies(r.replies);
    } catch (e) {
      setDetailError(apiErrorMessage(t, e));
    } finally {
      setDetailLoading(false);
    }
  }

  async function sendReply() {
    if (!active || !replyBody.trim()) return;
    setBusy(true);
    setDetailError(null);
    try {
      await adminApi.replyTicket(active.id, replyBody.trim());
      toast(t("p12.admin.replySent"));
      setReplyBody("");
      await openTicket(active.id);
      retry();
    } catch (e) {
      setDetailError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function setStatusOf(id: string, s: "open" | "answered" | "closed") {
    setBusy(true);
    setDetailError(null);
    try {
      const r = await adminApi.setTicketStatus(id, s);
      setActive(r.ticket);
      retry();
    } catch (e) {
      setDetailError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  const tickets = data ?? [];

  return (
    <div className="screen">
      <h1>{t("p12.admin.tickets")}</h1>

      <div className="tabrow" style={{ flexWrap: "wrap" }}>
        <button className={`tab${status === "" ? " on" : ""}`} onClick={() => setStatus("")}>
          {t("p12.admin.everyone")}
        </button>
        {(["open", "answered", "closed"] as const).map((s) => (
          <button
            key={s}
            className={`tab${status === s ? " on" : ""}`}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
          >
            {statusLabel(s)}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      {listError && <ErrorCard message={listError} onRetry={retry} />}

      {!loading && !error && tickets.length === 0 && (
        <EmptyState icon={<Icon.chat size={32} />} title={t("p12.admin.noTickets")} />
      )}

      {!active && tickets.map((tk) => (
        <div className="card" key={tk.id}>
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <b>{tk.subject}</b>
              <div className="tiny muted">{tk.created_at.slice(0, 10)}</div>
            </div>
            <Chip tone={STATUS_TONE[tk.status]}>{statusLabel(tk.status)}</Chip>
            <button className="linklike" onClick={() => openTicket(tk.id)}>
              {t("p12.common.view")}
            </button>
          </div>
        </div>
      ))}

      {active && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("p12.admin.ticketDetail")}</h3>
          {detailLoading && <p className="tiny muted">{t("common.loading")}</p>}
          {detailError && <ErrorCard message={detailError} />}
          <div className="rowflex">
            <b style={{ flex: 1 }}>{active.subject}</b>
            <Chip tone={STATUS_TONE[active.status]}>{statusLabel(active.status)}</Chip>
          </div>
          <div className="tiny muted" style={{ margin: "4px 0 8px" }}>
            {active.created_at.slice(0, 16).replace("T", " ")}
          </div>

          {replies.map((r) => (
            <div
              key={r.id}
              style={{
                margin: "6px 0",
                padding: 8,
                borderRadius: 8,
                background: r.author_role === "customer" ? "var(--bg)" : "var(--line)",
              }}
            >
              <div className="tiny muted">{r.author_role} · {r.created_at.slice(0, 16).replace("T", " ")}</div>
              <div className="tiny" style={{ marginTop: 2 }}>{r.body}</div>
            </div>
          ))}

          {active.status !== "closed" && (
            <>
              <label className="fl" htmlFor="tk-reply">{t("p12.admin.replyPh")}</label>
              <textarea
                id="tk-reply"
                rows={2}
                placeholder={t("p12.admin.replyPh")}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
              />
              <div className="btn-row">
                <button
                  className="btn btn-p"
                  style={{ width: "auto", margin: 0 }}
                  disabled={busy || !replyBody.trim()}
                  onClick={sendReply}
                >
                  {busy ? t("common.loading") : t("p12.admin.sendReply")}
                </button>
                <button
                  className="linklike"
                  style={{ color: "var(--bad)" }}
                  disabled={busy}
                  onClick={() => setStatusOf(active.id, "closed")}
                >
                  {t("p12.admin.closeTicket")}
                </button>
              </div>
            </>
          )}
          {active.status === "closed" && (
            <button className="linklike" disabled={busy} onClick={() => setStatusOf(active.id, "open")}>
              {t("p12.admin.reopen")}
            </button>
          )}
          <div style={{ marginTop: 8 }}>
            <button className="linklike" onClick={() => { setActive(null); setReplies([]); }}>
              ← {t("p12.admin.tickets")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
