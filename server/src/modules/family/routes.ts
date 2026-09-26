// P-7: family members — invite by token, share data with owner.
// A customer can add family members, hand them an invite token once, and
// (if the member accepts and consents) view their scans. The member controls
// their own data sharing; the owner can only read when data_shared is true.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, forbidden } from "../../http";
import { requireRole, requireAuth, type AuthedRequest } from "../../middleware/auth";

export function familyRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;

  // POST /family/members — customer adds a family member; invite_token shown once.
  r.post("/members", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const { name, relation } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) throw badRequest("name is required.");
    if (relation !== undefined && relation !== null && typeof relation !== "string") {
      throw badRequest("relation must be a string.");
    }
    const member = await store.createFamilyMember({
      owner_id: req.user!.id,
      name: name.trim(),
      relation: typeof relation === "string" ? relation : null,
    });
    res.status(201).json({ member }); // includes invite_token once
  }));

  // GET /family/members — customer's own member list.
  r.get("/members", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ members: await store.listFamilyMembers(req.user!.id) });
  }));

  // POST /family/accept {token} — any authed user claims an invite.
  r.post("/accept", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const { token } = req.body ?? {};
    if (typeof token !== "string" || !token) throw badRequest("token is required.");
    const accepted = await store.acceptFamilyInvite(token, req.user!.id);
    if (accepted) return res.json({ member: accepted });
    // null either means the token never existed, or someone else claimed it.
    const row = await store.getFamilyMemberByToken(token);
    if (!row) throw notFound("Invalid invite token.");
    throw conflict("This invite has already been accepted by someone else.", { member_id: row.id });
  }));

  // PATCH /family/members/:id/share {shared} — the member themselves only.
  r.patch("/members/:id/share", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const { shared } = req.body ?? {};
    if (typeof shared !== "boolean") throw badRequest("shared must be a boolean.");
    const row = await store.getFamilyMember(req.params.id);
    if (!row) throw notFound("Family member not found.");
    if (row.member_user_id !== req.user!.id) {
      throw forbidden("Only the family member themselves can change data sharing.");
    }
    const updated = await store.setFamilyMemberShare(req.params.id, shared);
    res.json({ member: updated });
  }));

  // GET /family/members/:id/scans — the OWNER only, and only when the member
  // accepted the invite and consented to share data.
  r.get("/members/:id/scans", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const row = await store.getFamilyMember(req.params.id);
    if (!row) throw notFound("Family member not found.");
    if (row.owner_id !== req.user!.id) throw forbidden("Not your family member.");
    if (!row.member_user_id || !row.data_shared) {
      throw forbidden("Data sharing is not enabled for this member.");
    }
    res.json({ scans: await store.listUserScans(row.member_user_id) });
  }));

  // DELETE /family/members/:id — owner only (customer action; no audit).
  r.delete("/members/:id", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const row = await store.getFamilyMember(req.params.id);
    if (!row) throw notFound("Family member not found.");
    if (row.owner_id !== req.user!.id) throw forbidden("Not your family member.");
    await store.removeFamilyMember(req.params.id);
    res.json({ deleted: true, member_id: req.params.id });
  }));

  return r;
}
