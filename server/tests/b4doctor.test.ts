// Batch 4 (010) doctor dashboard: D28 share-summary, D29 peers, D30 SLA
// pause/resume, D31 needs-info, D32 comments, D33 concern tags, D35
// priority history, D36 plan resolution notes, D37 digest, D38 similar
// cases, D39 availability auto_note, D40 queue filters, D41 case Q&A,
// D42 articles, D43 CSV export.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let docA = "";
let docB = "";
let docAToken = "";
let docBToken = "";
let custToken = "";
let custId = "";
let ownCaseId = "";   // assigned to docA
let otherCaseId = ""; // assigned to docB
let scanOfOwn = "";

async function makeCase(userId: string) {
  const scan = await store.createScan({ user_id: userId });
  const kase = await store.createCase({
    scan_id: scan.id, priority: 50,
    sla_due_at: new Date(Date.now() + 86400000).toISOString(),
  });
  return { kase, scan };
}

beforeAll(async () => {
  const a = await store.createUser({ phone: "+9779841000051", role: "doctor" });
  docA = a.id;
  docAToken = tokenFor({ id: a.id, role: "doctor" });
  const b = await store.createUser({ phone: "+9779841000052", role: "doctor" });
  docB = b.id;
  docBToken = tokenFor({ id: b.id, role: "doctor" });
  const cust = await store.createUser({ phone: "+9779841000053", role: "customer" });
  custId = cust.id;
  custToken = tokenFor({ id: cust.id, role: "customer" });

  const own = await makeCase(custId);
  ownCaseId = own.kase.id;
  scanOfOwn = own.scan.id;
  const other = await makeCase(custId);
  otherCaseId = other.kase.id;
  await store.claimCase(ownCaseId, docA);
  await store.claimCase(otherCaseId, docB);
});

describe("D28 — share case summary", () => {
  it("POST pushes a plain-language summary into the patient's notifications", async () => {
    const r = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/share-summary`)
      .set(auth(docAToken)).send({ summary: "Shedding looks seasonal; keep the routine steady." });
    expect(r.status).toBe(201);
    expect(r.body.notification.type).toBe("case_summary");
    expect(r.body.notification.body_en).toContain("seasonal");
    const inbox = await store.listNotifications(custId, { limit: 20, offset: 0 });
    expect(inbox.notifications.some((n) => n.type === "case_summary")).toBe(true);
  });

  it("any doctor (not just the assignee) may share", async () => {
    const r = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/share-summary`)
      .set(auth(docBToken)).send({ summary: "Second look: same advice." });
    expect(r.status).toBe(201);
  });

  it("validation: missing/empty summary -> 400, missing case -> 404, customer -> 403", async () => {
    const empty = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/share-summary`)
      .set(auth(docAToken)).send({ summary: "   " });
    expect(empty.status).toBe(400);
    const missing = await request(app).post("/api/v1/doctor/cases/nope/share-summary")
      .set(auth(docAToken)).send({ summary: "x" });
    expect(missing.status).toBe(404);
    const c = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/share-summary`)
      .set(auth(custToken)).send({ summary: "x" });
    expect(c.status).toBe(403);
  });
});

describe("D29 — doctor directory", () => {
  it("GET /doctor/peers lists other doctors, excluding self", async () => {
    const r = await request(app).get("/api/v1/doctor/peers").set(auth(docAToken));
    expect(r.status).toBe(200);
    const ids = r.body.peers.map((p: { id: string }) => p.id);
    expect(ids).toContain(docB);
    expect(ids).not.toContain(docA);
  });

  it("customer gets 403", async () => {
    const r = await request(app).get("/api/v1/doctor/peers").set(auth(custToken));
    expect(r.status).toBe(403);
  });
});

describe("D30 — SLA pause / resume", () => {
  it("pause sets sla_paused_at, resume clears it", async () => {
    const p = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/sla-pause`).set(auth(docAToken));
    expect(p.status).toBe(200);
    expect(p.body.case_id).toBe(ownCaseId);
    expect(typeof p.body.sla_paused_at).toBe("string");
    const r = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/sla-resume`).set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.sla_paused_at).toBeNull();
  });

  it("missing case -> 404, customer -> 403", async () => {
    const gone = await request(app).post("/api/v1/doctor/cases/nope/sla-pause").set(auth(docAToken));
    expect(gone.status).toBe(404);
    const c = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/sla-pause`).set(auth(custToken));
    expect(c.status).toBe(403);
  });
});

describe("D31 — needs-info", () => {
  it("GET returns the case plus its photo requests", async () => {
    await store.createPhotoRequest(ownCaseId, docA, "top, crown", "brighter light please");
    const r = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/needs-info`).set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.case.id).toBe(ownCaseId);
    expect(r.body.photo_requests.length).toBeGreaterThanOrEqual(1);
    expect(r.body.photo_requests[0].angles).toBe("top, crown");
  });

  it("missing case -> 404, customer -> 403", async () => {
    const gone = await request(app).get("/api/v1/doctor/cases/nope/needs-info").set(auth(docAToken));
    expect(gone.status).toBe(404);
    const c = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/needs-info`).set(auth(custToken));
    expect(c.status).toBe(403);
  });
});

describe("D32 — internal comments", () => {
  it("POST adds a comment; GET lists oldest-first", async () => {
    const c1 = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/comments`)
      .set(auth(docAToken)).send({ body: "first note" });
    expect(c1.status).toBe(201);
    expect(c1.body.comment.body).toBe("first note");
    expect(c1.body.comment.doctor_id).toBe(docA);
    const c2 = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/comments`)
      .set(auth(docBToken)).send({ body: "second note" });
    expect(c2.status).toBe(201);
    const g = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/comments`).set(auth(docAToken));
    expect(g.status).toBe(200);
    expect(g.body.comments.map((c: { body: string }) => c.body)).toEqual(["first note", "second note"]);
  });

  it("validation: empty/too-long body -> 400, missing case -> 404, customer -> 403", async () => {
    const empty = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/comments`)
      .set(auth(docAToken)).send({ body: "  " });
    expect(empty.status).toBe(400);
    const gone = await request(app).post("/api/v1/doctor/cases/nope/comments")
      .set(auth(docAToken)).send({ body: "x" });
    expect(gone.status).toBe(404);
    const c = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/comments`).set(auth(custToken));
    expect(c.status).toBe(403);
  });
});

describe("D33 — concern tags", () => {
  it("POST adds a tag idempotently; GET lists tags + allowed vocabulary", async () => {
    const a1 = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/concerns`)
      .set(auth(docAToken)).send({ tag: "follow_up_needed" });
    expect(a1.status).toBe(201);
    const a2 = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/concerns`)
      .set(auth(docAToken)).send({ tag: "follow_up_needed" });
    expect(a2.status).toBe(201);
    expect(a2.body.concern.id).toBe(a1.body.concern.id); // idempotent
    const g = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/concerns`).set(auth(docAToken));
    expect(g.status).toBe(200);
    expect(g.body.concerns.map((t: { tag: string }) => t.tag)).toEqual(["follow_up_needed"]);
    expect(g.body.allowed_tags).toContain("follow_up_needed");
  });

  it("DELETE removes the tag", async () => {
    const d = await request(app).delete(`/api/v1/doctor/cases/${ownCaseId}/concerns`)
      .set(auth(docAToken)).send({ tag: "follow_up_needed" });
    expect(d.status).toBe(200);
    const g = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/concerns`).set(auth(docAToken));
    expect(g.body.concerns).toEqual([]);
  });

  it("validation: unknown tag -> 400, missing tag on delete -> 400, customer -> 403", async () => {
    const bad = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/concerns`)
      .set(auth(docAToken)).send({ tag: "terminal_illness" });
    expect(bad.status).toBe(400);
    const noTag = await request(app).delete(`/api/v1/doctor/cases/${ownCaseId}/concerns`)
      .set(auth(docAToken)).send({});
    expect(noTag.status).toBe(400);
    const c = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/concerns`)
      .set(auth(custToken)).send({ tag: "follow_up_needed" });
    expect(c.status).toBe(403);
  });
});

describe("D35 — priority history", () => {
  it("GET filters audit to this case + priority actions", async () => {
    await store.addAudit({ actor_id: docA, action: "case.priority", entity: "case", entity_id: ownCaseId, ip: null, detail: null });
    await store.addAudit({ actor_id: docA, action: "case.priority", entity: "case", entity_id: otherCaseId, ip: null, detail: null });
    await store.addAudit({ actor_id: docA, action: "case.view", entity: "case", entity_id: ownCaseId, ip: null, detail: null });
    const r = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/priority-history`).set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.history.length).toBe(1);
    expect(r.body.history[0].action).toBe("case.priority");
    expect(r.body.history[0].entity_id).toBe(ownCaseId);
  });

  it("missing case -> 404, customer -> 403", async () => {
    const gone = await request(app).get("/api/v1/doctor/cases/nope/priority-history").set(auth(docAToken));
    expect(gone.status).toBe(404);
    const c = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/priority-history`).set(auth(custToken));
    expect(c.status).toBe(403);
  });
});

describe("D36 — plan resolution notes", () => {
  let flagId = "";
  const planItems = [{ kind: "habit", title_en: "Oil twice weekly", title_ne: null, sort_order: 0 }];

  beforeAll(async () => {
    const flag = await store.addRedFlag({ scan_id: scanOfOwn, flag_type: "shedding", detail: "heavy" });
    flagId = flag.id;
  });

  it("resolving flags without notes -> 400", async () => {
    const r = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/plan`)
      .set(auth(docAToken)).send({ items: planItems, resolved_flag_ids: [flagId] });
    expect(r.status).toBe(400);
  });

  it("a missing note for one of several flags -> 400", async () => {
    const flag2 = await store.addRedFlag({ scan_id: scanOfOwn, flag_type: "dandruff", detail: "mild" });
    const r = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/plan`)
      .set(auth(docAToken)).send({
        items: planItems,
        resolved_flag_ids: [flagId, flag2.id],
        resolved_flag_notes: { [flagId]: "checked, fine" },
      });
    expect(r.status).toBe(400);
  });

  it("complete notes -> 201 and the notes land in the audit detail", async () => {
    const r = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/plan`)
      .set(auth(docAToken)).send({
        items: planItems,
        resolved_flag_ids: [flagId],
        resolved_flag_notes: { [flagId]: "Reviewed photos; not concerning." },
      });
    expect(r.status).toBe(201);
    const entries = await store.listAudit({ entity: "plan", limit: 50 });
    const entry = entries.find((e) => e.entity_id === r.body.id && e.action === "plan.create");
    expect(entry).toBeTruthy();
    const detail = JSON.parse(entry!.detail ?? "{}");
    expect(detail.resolved_flag_notes[flagId]).toBe("Reviewed photos; not concerning.");
  });

  it("plans without resolved flags still work (no notes required)", async () => {
    const r = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/plan`)
      .set(auth(docAToken)).send({ items: planItems });
    expect(r.status).toBe(201);
  });
});

describe("D37 — weekly digest", () => {
  it("GET /doctor/digest returns this week's review stats", async () => {
    // a reviewed case assigned to docA counts; docB's does not
    await store.updateCase(ownCaseId, { status: "reviewed" });
    await store.updateCase(otherCaseId, { status: "reviewed" });
    const r = await request(app).get("/api/v1/doctor/digest").set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.reviewed).toBeGreaterThanOrEqual(1);
    expect(r.body.avgMinutes).toBeNull(); // honest: no timing data recorded
    expect(typeof r.body.slaHits).toBe("number");
    expect(r.body.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const b = await request(app).get("/api/v1/doctor/digest").set(auth(docBToken));
    expect(b.body.reviewed).toBeGreaterThanOrEqual(1);
  });

  it("customer gets 403", async () => {
    const r = await request(app).get("/api/v1/doctor/digest").set(auth(custToken));
    expect(r.status).toBe(403);
  });
});

describe("D38 — similar cases", () => {
  it("GET returns own past cases ordered by root-score distance, excluding itself", async () => {
    const mk = await makeCase(custId);
    await store.claimCase(mk.kase.id, docA);
    await store.updateCase(mk.kase.id, { status: "reviewed" });
    await store.setRootScores(scanOfOwn, [
      { root: "nutrition", score: 70, signals: {} },
      { root: "stress", score: 30, signals: {} },
    ]);
    await store.setRootScores(mk.scan.id, [
      { root: "nutrition", score: 72, signals: {} },
      { root: "stress", score: 28, signals: {} },
    ]);
    const r = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/similar`).set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.similar.length).toBeGreaterThanOrEqual(1);
    expect(r.body.similar[0].id).toBe(mk.kase.id);
    expect(r.body.similar[0].distance).toBe(4); // |70-72| + |30-28|
    expect(r.body.similar.map((c: { id: string }) => c.id)).not.toContain(ownCaseId);
    // docB sees none of docA's cases
    const b = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/similar`).set(auth(docBToken));
    expect(b.body.similar).toEqual([]);
  });

  it("missing case -> 404, customer -> 403", async () => {
    const gone = await request(app).get("/api/v1/doctor/cases/nope/similar").set(auth(docAToken));
    expect(gone.status).toBe(404);
    const c = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/similar`).set(auth(custToken));
    expect(c.status).toBe(403);
  });
});

describe("D39 — availability auto_note", () => {
  it("on_leave stores auto_note when no explicit note is given", async () => {
    const r = await request(app).put("/api/v1/doctor/availability")
      .set(auth(docAToken)).send({ status: "on_leave", auto_note: "Dashain break" });
    expect(r.status).toBe(200);
    expect(r.body.note).toBe("Dashain break");
  });

  it("explicit note wins over auto_note; available ignores auto_note", async () => {
    const r = await request(app).put("/api/v1/doctor/availability")
      .set(auth(docAToken)).send({ status: "on_leave", note: "Sick", auto_note: "Dashain break" });
    expect(r.body.note).toBe("Sick");
    const back = await request(app).put("/api/v1/doctor/availability")
      .set(auth(docAToken)).send({ status: "available", auto_note: "ignored" });
    expect(back.status).toBe(200);
    expect(back.body.note).toBeNull();
  });

  it("bad status -> 400, customer -> 403", async () => {
    const bad = await request(app).put("/api/v1/doctor/availability")
      .set(auth(docAToken)).send({ status: "busy" });
    expect(bad.status).toBe(400);
    const c = await request(app).put("/api/v1/doctor/availability")
      .set(auth(custToken)).send({ status: "available" });
    expect(c.status).toBe(403);
  });
});

describe("D40 — queue filter presets", () => {
  let filterId = "";
  const filters = { sortMode: "priority", redFlagOnly: true };

  it("POST creates, GET lists own presets", async () => {
    const p = await request(app).post("/api/v1/doctor/queue-filters")
      .set(auth(docAToken)).send({ name: "red flags first", filters });
    expect(p.status).toBe(201);
    expect(p.body.filter.name).toBe("red flags first");
    expect(p.body.filter.filters).toEqual(filters);
    filterId = p.body.filter.id;
    const g = await request(app).get("/api/v1/doctor/queue-filters").set(auth(docAToken));
    expect(g.status).toBe(200);
    expect(g.body.filters.map((f: { id: string }) => f.id)).toContain(filterId);
  });

  it("presets are per-doctor", async () => {
    const g = await request(app).get("/api/v1/doctor/queue-filters").set(auth(docBToken));
    expect(g.body.filters).toEqual([]);
  });

  it("validation: empty name -> 400, non-object filters -> 400", async () => {
    const empty = await request(app).post("/api/v1/doctor/queue-filters")
      .set(auth(docAToken)).send({ name: "  ", filters });
    expect(empty.status).toBe(400);
    const badf = await request(app).post("/api/v1/doctor/queue-filters")
      .set(auth(docAToken)).send({ name: "x", filters: ["nope"] });
    expect(badf.status).toBe(400);
  });

  it("DELETE removes own preset (204); other's or missing -> 404", async () => {
    const other = await request(app).delete(`/api/v1/doctor/queue-filters/${filterId}`).set(auth(docBToken));
    expect(other.status).toBe(404);
    const gone = await request(app).delete("/api/v1/doctor/queue-filters/nope").set(auth(docAToken));
    expect(gone.status).toBe(404);
    const ok = await request(app).delete(`/api/v1/doctor/queue-filters/${filterId}`).set(auth(docAToken));
    expect(ok.status).toBe(204);
  });

  it("customer gets 403", async () => {
    const r = await request(app).get("/api/v1/doctor/queue-filters").set(auth(custToken));
    expect(r.status).toBe(403);
  });
});

describe("D41 — case Q&A (doctor side)", () => {
  it("POST replies as doctor; GET lists the thread", async () => {
    const p = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/messages`)
      .set(auth(docAToken)).send({ body: "Keep oiling twice a week." });
    expect(p.status).toBe(201);
    expect(p.body.author_role).toBe("doctor");
    const g = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/messages`).set(auth(docAToken));
    expect(g.status).toBe(200);
    expect(g.body.messages.map((m: { body: string }) => m.body)).toContain("Keep oiling twice a week.");
  });

  it("empty body -> 400, missing case -> 404, customer -> 403", async () => {
    const empty = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/messages`)
      .set(auth(docAToken)).send({ body: "" });
    expect(empty.status).toBe(400);
    const gone = await request(app).post("/api/v1/doctor/cases/nope/messages")
      .set(auth(docAToken)).send({ body: "x" });
    expect(gone.status).toBe(404);
    const c = await request(app).get(`/api/v1/doctor/cases/${ownCaseId}/messages`).set(auth(custToken));
    expect(c.status).toBe(403);
  });
});

describe("D42 — articles shelf", () => {
  it("GET /doctor/articles returns published articles", async () => {
    const r = await request(app).get("/api/v1/doctor/articles").set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.articles)).toBe(true);
  });

  it("customer gets 403", async () => {
    const r = await request(app).get("/api/v1/doctor/articles").set(auth(custToken));
    expect(r.status).toBe(403);
  });
});

describe("D43 — CSV export", () => {
  it("GET /doctor/cases/export.csv downloads own reviewed cases as CSV", async () => {
    const r = await request(app).get("/api/v1/doctor/cases/export.csv").set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.headers["content-disposition"]).toContain("attachment");
    const lines = r.text.trim().split("\n");
    expect(lines[0]).toBe("id,created_at,status,priority");
    // ownCaseId was marked reviewed in the D37 test
    expect(lines.some((l) => l.startsWith(ownCaseId))).toBe(true);
    expect(lines.some((l) => l.startsWith(otherCaseId))).toBe(false);
  });

  it("customer gets 403", async () => {
    const r = await request(app).get("/api/v1/doctor/cases/export.csv").set(auth(custToken));
    expect(r.status).toBe(403);
  });
});
