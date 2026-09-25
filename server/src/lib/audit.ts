// Audit helper — every doctor/admin read of a case, annotation, plan approval,
// and flag toggle writes an audit_log row (compliance, blueprint §13).
import type { Store } from "../db/store";

export async function audit(
  store: Store,
  opts: { actorId?: string | null; action: string; entity: string; entityId?: string | null; ip?: string | null; detail?: string | null },
): Promise<void> {
  try {
    await store.addAudit({
      actor_id: opts.actorId ?? null,
      action: opts.action,
      entity: opts.entity,
      entity_id: opts.entityId ?? null,
      ip: opts.ip ?? null,
      detail: opts.detail ?? null,
    });
  } catch (e) {
    // audit must never break the request path; log and continue
    console.error("[audit] write failed:", e);
  }
}
