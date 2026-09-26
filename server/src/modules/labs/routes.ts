// P-6: lab tests, providers, bookings, report uploads.
// Lab partners are not wired yet (no provider records exist); the provider
// endpoints return honest empty lists until a real partner is configured.
// When an admin uploads a report the booking moves to report_ready and a free
// doctor review is requested — the report upload itself never fails on the
// consult/notification side-effects.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, forbidden, clientIp } from "../../http";
import { requireRole, requireAuth, type AuthedRequest } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import type { LabBookingStatus } from "../../db/types";

const BOOKING_STATUSES = ["sample_collected", "cancelled"] as const;

export function labsRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;

  // GET /labs/tests — active tests, any authenticated role.
  r.get("/tests", requireAuth, asyncHandler(async (_req, res) => {
    res.json({ tests: await store.listLabTests(true) });
  }));

  // POST /labs/tests — admin adds a test.
  r.post("/tests", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { name_en, name_ne, description_en, description_ne, price_npr, provider_id } = req.body ?? {};
    if (typeof name_en !== "string" || !name_en.trim()) throw badRequest("name_en is required.");
    if (typeof price_npr !== "number" || !(price_npr >= 0)) throw badRequest("price_npr must be a number >= 0.");
    if (provider_id !== undefined && provider_id !== null && typeof provider_id !== "string") {
      throw badRequest("provider_id must be a string.");
    }
    const test = await store.createLabTest({
      provider_id: provider_id ?? null,
      name_en: name_en.trim(),
      name_ne: typeof name_ne === "string" ? name_ne : null,
      description_en: typeof description_en === "string" ? description_en : null,
      description_ne: typeof description_ne === "string" ? description_ne : null,
      price_npr,
    });
    await audit(store, {
      actorId: req.user!.id, action: "lab.test.create", entity: "lab_test",
      entityId: test.id, ip: clientIp(req),
    });
    res.status(201).json({ test });
  }));

  // PATCH /labs/tests/:id — admin edits a test (partial).
  r.patch("/tests/:id", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { name_en, name_ne, description_en, description_ne, price_npr, is_active } = req.body ?? {};
    const patch: Parameters<typeof store.updateLabTest>[1] = {};
    if (name_en !== undefined) {
      if (typeof name_en !== "string" || !name_en.trim()) throw badRequest("name_en must be a non-empty string.");
      patch.name_en = name_en.trim();
    }
    if (name_ne !== undefined) patch.name_ne = typeof name_ne === "string" ? name_ne : null;
    if (description_en !== undefined) patch.description_en = typeof description_en === "string" ? description_en : null;
    if (description_ne !== undefined) patch.description_ne = typeof description_ne === "string" ? description_ne : null;
    if (price_npr !== undefined) {
      if (typeof price_npr !== "number" || !(price_npr >= 0)) throw badRequest("price_npr must be a number >= 0.");
      patch.price_npr = price_npr;
    }
    if (is_active !== undefined) {
      if (typeof is_active !== "boolean") throw badRequest("is_active must be a boolean.");
      patch.is_active = is_active;
    }
    const test = await store.updateLabTest(req.params.id, patch);
    if (!test) throw notFound("Lab test not found.");
    await audit(store, {
      actorId: req.user!.id, action: "lab.test.update", entity: "lab_test",
      entityId: test.id, ip: clientIp(req),
    });
    res.json({ test });
  }));

  // GET /labs/providers — honest empty until a real lab partner is configured.
  r.get("/providers", requireRole("admin"), asyncHandler(async (_req, res) => {
    const providers = await store.listLabProviders();
    res.json({
      providers,
      meta: providers.length === 0 ? { note: "no lab partner configured yet" } : undefined,
    });
  }));

  // POST /labs/providers — admin registers a lab partner.
  r.post("/providers", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { name_en, name_ne, note } = req.body ?? {};
    if (typeof name_en !== "string" || !name_en.trim()) throw badRequest("name_en is required.");
    const provider = await store.createLabProvider({
      name_en: name_en.trim(),
      name_ne: typeof name_ne === "string" ? name_ne : null,
      note: typeof note === "string" ? note : null,
    });
    await audit(store, {
      actorId: req.user!.id, action: "lab.provider.create", entity: "lab_provider",
      entityId: provider.id, ip: clientIp(req),
    });
    res.status(201).json({ provider });
  }));

  // POST /labs/bookings — customer books a lab test (customer action; no audit).
  r.post("/bookings", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const { test_id, scheduled_on, slot, address, phone } = req.body ?? {};
    if (typeof test_id !== "string" || !test_id) throw badRequest("test_id is required.");
    if (typeof phone !== "string" || !phone.trim()) throw badRequest("phone is required.");
    if (typeof address !== "object" || address === null || Array.isArray(address)) {
      throw badRequest("address must be an object.");
    }
    const test = await store.getLabTest(test_id);
    if (!test) throw notFound("Lab test not found.");
    if (!test.is_active) throw badRequest("This test is not available for booking.");
    const booking = await store.createLabBooking({
      user_id: req.user!.id,
      test_id,
      scheduled_on: typeof scheduled_on === "string" ? scheduled_on : null,
      slot: typeof slot === "string" ? slot : null,
      address: address as Record<string, unknown>,
      phone: phone.trim(),
    });
    res.status(201).json({ booking });
  }));

  // GET /labs/bookings — customers see own; admin/pharmacy see all (?status= filter).
  r.get("/bookings", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const role = req.user!.role;
    if (role === "admin" || role === "pharmacy") {
      const { status } = req.query;
      const bookings = typeof status === "string" && status
        ? await store.listLabBookings(status)
        : await store.listLabBookings();
      res.json({ bookings });
    } else {
      res.json({ bookings: await store.listLabBookingsByUser(req.user!.id) });
    }
  }));

  function canSeeBooking(req: AuthedRequest, userId: string) {
    const role = req.user!.role;
    return role === "admin" || role === "pharmacy" || userId === req.user!.id;
  }

  // GET /labs/bookings/:id — owner, admin, pharmacy.
  r.get("/bookings/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const booking = await store.getLabBooking(req.params.id);
    if (!booking) throw notFound("Lab booking not found.");
    if (!canSeeBooking(req, booking.user_id)) throw forbidden("Not your booking.");
    res.json({ booking });
  }));

  // PATCH /labs/bookings/:id — admin status move. report_ready is only ever
  // set by the report upload below, never by a direct status change.
  r.patch("/bookings/:id", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { status } = req.body ?? {};
    if (typeof status !== "string" || !(BOOKING_STATUSES as readonly string[]).includes(status)) {
      throw badRequest("status must be one of: " + BOOKING_STATUSES.join(", ") + " (report_ready is set only by report upload).");
    }
    const booking = await store.getLabBooking(req.params.id);
    if (!booking) throw notFound("Lab booking not found.");
    const updated = await store.updateLabBookingStatus(req.params.id, status as LabBookingStatus);
    await audit(store, {
      actorId: req.user!.id, action: `lab.booking.${status}`, entity: "lab_booking",
      entityId: req.params.id, ip: clientIp(req),
    });
    res.json({ booking: updated });
  }));

  // POST /labs/bookings/:id/report — admin uploads the report file location.
  // Sets report_ready, requests a free doctor review, notifies the user.
  // The consult/notification side-effects never fail the upload itself.
  r.post("/bookings/:id/report", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { storage_path } = req.body ?? {};
    if (typeof storage_path !== "string" || !storage_path.trim()) throw badRequest("storage_path is required.");
    const booking = await store.getLabBooking(req.params.id);
    if (!booking) throw notFound("Lab booking not found.");
    const report = await store.attachLabReport(req.params.id, storage_path.trim(), req.user!.id);
    try {
      await store.createConsult({ user_id: booking.user_id, status: "requested" });
    } catch (e) { console.error("[labs] free doctor review request failed:", e); }
    try {
      await store.createNotification({
        user_id: booking.user_id,
        type: "lab_report",
        title_en: "Lab report ready",
        title_ne: "ल्याब रिपोर्ट तयार छ",
        body_en: "Your lab report is ready. A free doctor review has been requested.",
        body_ne: "तपाईंको ल्याब रिपोर्ट तयार छ। निःशुल्क डाक्टर समीक्षा अनुरोध गरिएको छ।",
      });
    } catch (e) { console.error("[labs] report-ready notification failed:", e); }
    await audit(store, {
      actorId: req.user!.id, action: "lab.report.attach", entity: "lab_booking",
      entityId: req.params.id, ip: clientIp(req),
    });
    res.status(201).json({ report, booking_id: req.params.id });
  }));

  // GET /labs/bookings/:id/report — owner, admin, pharmacy.
  r.get("/bookings/:id/report", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const booking = await store.getLabBooking(req.params.id);
    if (!booking) throw notFound("Lab booking not found.");
    if (!canSeeBooking(req, booking.user_id)) throw forbidden("Not your booking.");
    const report = await store.getLabReport(req.params.id);
    if (!report) throw notFound("No report uploaded for this booking yet.");
    res.json({ report });
  }));

  return r;
}
