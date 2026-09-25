import { useState } from "react";
import { meApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../components/ui";
import { useAsync } from "../components/useAsync";
import { Icon } from "../components/icons";
import type { SupportTicket } from "../api/types";

const FAQ_N = 5;

/** U7 — Help: bilingual FAQ accordion + the customer's own support tickets. */
export default function Help() {
  const { t } = useLang();
  const [openQ, setOpenQ] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<Record<string, { ticket: SupportTicket; replies: { id: string; author_role: string; body: string; created_at: string }[] }>>({});
  const [reply, setReply] = useState("");

  const { data, error, loading, retry } = useAsync(() => meApi.listTickets().then((r) => r.tickets), []);
  const listErr = error ? apiErrorMessage(t, error) : null;

  async function createTicket() {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      await meApi.createTicket(subject.trim(), body.trim());
      setSubject("");
      setBody("");
      toast(t("p12.customer.ticketOpened"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setSending(false);
    }
  }

  async function loadTicket(id: string) {
    if (openTicket === id) {
      setOpenTicket(null);
      return;
    }
    setOpenTicket(id);
    if (!ticketDetail[id]) {
      try {
        const r = await meApi.getTicket(id);
        setTicketDetail((p) => ({ ...p, [id]: r }));
      } catch (e) {
        toast(apiErrorMessage(t, e));
        setOpenTicket(null);
      }
    }
  }

  async function sendReply(id: string) {
    if (!reply.trim()) return;
    try {
      await meApi.replyTicket(id, reply.trim());
      setReply("");
      const r = await meApi.getTicket(id);
      setTicketDetail((p) => ({ ...p, [id]: r }));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  const tickets = data ?? [];
  const statusTone = (s: string): "gold" | "grey" | "red" => (s === "open" ? "gold" : s === "answered" ? "grey" : "red");

  return (
    <div className="screen">
      <h1>{t("p12.customer.help")}</h1>

      {Array.from({ length: FAQ_N }, (_, i) => i + 1).map((n) => (
        <div className="card" key={n}>
          <button
            type="button"
            onClick={() => setOpenQ(openQ === n ? null : n)}
            aria-expanded={openQ === n}
            style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <div className="rowflex">
              <b>{t(`p12.help.q${n}`)}</b>
              <span className="spacer" />
              <span aria-hidden="true">{openQ === n ? "▾" : "▸"}</span>
            </div>
          </button>
          {openQ === n && <p className="tiny" style={{ margin: "8px 0 0" }}>{t(`p12.help.a${n}`)}</p>}
        </div>
      ))}

      <h3>{t("p12.customer.myTickets")}</h3>
      {loading && <Loading />}
      {listErr && <ErrorCard message={listErr} onRetry={retry} />}

      {!loading && tickets.length === 0 && (
        <EmptyState icon={<Icon.chat size={32} />} title={t("p12.customer.noTickets")} />
      )}

      {tickets.map((tk) => (
        <div className="card" key={tk.id}>
          <button
            type="button"
            onClick={() => void loadTicket(tk.id)}
            aria-expanded={openTicket === tk.id}
            style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <div className="rowflex">
              <div>
                <b>{tk.subject}</b>
                <br />
                <span className="tiny muted">{tk.created_at.slice(0, 10)}</span>
              </div>
              <span className="spacer" />
              <Chip tone={statusTone(tk.status)}>{tk.status}</Chip>
            </div>
          </button>
          {openTicket === tk.id && ticketDetail[tk.id] && (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              {ticketDetail[tk.id].replies.map((r) => (
                <p key={r.id} className="tiny" style={{ margin: "8px 0" }}>
                  <b>{r.author_role}</b> <span className="muted">{r.created_at.slice(0, 16).replace("T", " ")}</span>
                  <br />
                  {r.body}
                </p>
              ))}
              {tk.status !== "closed" && (
                <>
                  <label className="fl" htmlFor={`reply-${tk.id}`}>{t("p12.customer.messagePh")}</label>
                  <textarea
                    id={`reply-${tk.id}`}
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={t("p12.customer.messagePh")}
                  />
                  <button className="btn btn-s btn-p" disabled={!reply.trim()} onClick={() => void sendReply(tk.id)}>
                    {t("p12.common.save")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.customer.newTicket")}</h3>
        <label className="fl" htmlFor="tk-subject">{t("p12.customer.subjectPh")}</label>
        <input
          id="tk-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("p12.customer.subjectPh")}
        />
        <label className="fl" htmlFor="tk-body">{t("p12.customer.messagePh")}</label>
        <textarea
          id="tk-body"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("p12.customer.messagePh")}
        />
        <button className="btn btn-p" disabled={sending || !subject.trim() || !body.trim()} onClick={createTicket}>
          {sending ? t("p12.common.loading") : t("p12.customer.newTicket")}
        </button>
      </div>
    </div>
  );
}
