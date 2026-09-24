import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, featureDisabled } from "../../http";
import { requireAuth, type AuthedRequest } from "../../middleware/auth";
import { featureEnabled } from "../../middleware/flags";

export function consultsRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;

  // POST /consults/book — DISABLED until the legal phase flips teleconsult_booking.
  r.post("/book", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    if (!(await featureEnabled(store, "teleconsult_booking"))) {
      throw featureDisabled(
        "Teleconsult booking is not available yet. Your scan is saved — a dermatologist will review it, no booking needed right now.",
        { flag: "teleconsult_booking", enabled: false },
      );
    }
    const { doctor_id, scheduled_at, note } = req.body ?? {};
    if (!scheduled_at) throw badRequest("Request failed validation.", { field: "scheduled_at" });
    if (doctor_id) {
      const doctor = await store.getUserById(String(doctor_id));
      if (!doctor || doctor.role !== "doctor") throw badRequest("Request failed validation.", { field: "doctor_id" });
    }
    const consult = await store.createConsult({
      user_id: req.user!.id,
      doctor_id: doctor_id ? String(doctor_id) : null,
      scheduled_at: String(scheduled_at),
      status: "scheduled",
    });
    res.status(201).json({
      id: consult.id, user_id: consult.user_id, doctor_id: consult.doctor_id,
      scheduled_at: consult.scheduled_at, meet_link: consult.meet_link,
      status: consult.status, notes: note ?? null,
    });
  }));

  return r;
}
