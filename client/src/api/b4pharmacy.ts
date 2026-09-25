// Batch-4 (010) pharmacy API — P28–P45. Uses the exported request() only;
// local types live in this file. Auth/session handling comes from client.ts.
import { getAccessToken, request } from "./client";
import type { Announcement, Order, OrderCheck } from "./types";

export type AttemptStatus = "failed" | "rescheduled" | "delivered";

export interface DeliveryAttempt {
  id: string;
  order_id: string;
  status: AttemptStatus;
  note: string | null;
  created_at: string;
}

export interface StockCount {
  id: string;
  kit_id: string;
  system_qty: number;
  counted_qty: number;
  variance: number;
  counted_by: string | null;
  created_at: string;
}

export interface Substitution {
  id: string;
  order_id: string;
  from_kit_id: string | null;
  to_kit_id: string | null;
  reason: string;
  created_at: string;
}

export interface DeliveryProof {
  id: string;
  order_id: string;
  storage_path: string;
  note: string | null;
  created_at: string;
  /** Time-boxed view URL (900s). Present on upload + proof list. */
  url?: string | null;
}

export interface RefundRequest {
  id: string;
  order_id: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
}

export interface DispatchHoliday {
  id: string;
  date: string;
  label: string;
  created_at: string;
}

export interface CourierClaim {
  id: string;
  courier_name: string;
  order_id: string | null;
  amount_npr: number;
  reason: string;
  status: "open" | "filed" | "settled";
  created_at: string;
}

export interface ExpiringBatch {
  id: string;
  kit_id: string;
  kit_name: string;
  batch_no: string | null;
  expiry: string | null;
  days_left: number | null;
  qty: number;
}

export interface Manifest {
  date: string;
  courier: string | null;
  total: number;
  by_status: Record<string, number>;
  orders: Order[];
}

export type { Announcement, OrderCheck };

const j = (v: unknown) => JSON.stringify(v);

export const pharmacyB4Api = {
  // P28 — re-verify: clear + recreate verification checks as pending
  reverifyChecks(orderId: string): Promise<{ checks: OrderCheck[] }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/checks/reverify`, { method: "POST" });
  },

  // P29 — bulk status advance (audited per order)
  bulkUpdateStatus(ids: string[], status: string): Promise<{ updated: Order[]; failed: Array<{ id: string; reason: string }> }> {
    return request("/pharmacy/orders/bulk-status", { method: "POST", body: j({ ids, status }) });
  },

  // P31 — delivery attempts
  listAttempts(orderId: string): Promise<{ attempts: DeliveryAttempt[] }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/attempts`);
  },
  createAttempt(orderId: string, input: { status: AttemptStatus; note?: string }): Promise<{ attempt: DeliveryAttempt }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/attempts`, {
      method: "POST",
      body: j(input),
    });
  },

  // P32 — per-courier daily pickup manifest
  getManifest(courier?: string, date?: string): Promise<Manifest> {
    const p = new URLSearchParams();
    if (courier) p.set("courier", courier);
    if (date) p.set("date", date);
    const q = p.toString();
    return request(`/pharmacy/manifest${q ? `?${q}` : ""}`);
  },

  // P33 — physical stock count (variance = counted - system)
  countStock(kitId: string, counted_qty: number): Promise<{ count: StockCount }> {
    return request(`/pharmacy/kits/${encodeURIComponent(kitId)}/count`, {
      method: "POST",
      body: j({ counted_qty }),
    });
  },
  listStockCounts(kitId: string): Promise<{ counts: StockCount[] }> {
    return request(`/pharmacy/kits/${encodeURIComponent(kitId)}/counts`);
  },

  // P34 — rush flag (rush orders sort first in the queue)
  setRush(orderId: string, rush: boolean): Promise<{ order: Order }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/rush`, {
      method: "PATCH",
      body: j({ rush }),
    });
  },

  // P36-alt — kit batches expiring soon
  getExpiringBatches(days = 60): Promise<{ batches: ExpiringBatch[] }> {
    return request(`/pharmacy/batches/expiring?days=${encodeURIComponent(String(days))}`);
  },

  // P37 — monthly fulfilment CSV download (blob; request() is JSON-only)
  async downloadMonthlyCsv(month: string): Promise<void> {
    const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
    const token = getAccessToken();
    const res = await fetch(
      `${base}/api/v1/pharmacy/reports/monthly.csv?month=${encodeURIComponent(month)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      },
    );
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jaraa-fulfilment-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // P38 — kit substitutions
  listSubstitutions(orderId: string): Promise<{ substitutions: Substitution[] }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/substitutions`);
  },
  createSubstitution(
    orderId: string,
    input: { from_kit_id?: string | null; to_kit_id?: string | null; reason: string },
  ): Promise<{ substitution: Substitution }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/substitutions`, {
      method: "POST",
      body: j(input),
    });
  },

  // P39 — delivery photo proof (multipart; reuses the scan-photos bucket server-side)
  uploadProof(orderId: string, file: File | Blob, note?: string): Promise<{ proof: DeliveryProof }> {
    const fd = new FormData();
    fd.append("photo", file, "proof.jpg");
    if (note) fd.append("note", note);
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/proof`, {
      method: "POST",
      body: fd,
    });
  },
  listProofs(orderId: string): Promise<{ proofs: DeliveryProof[] }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/proofs`);
  },

  // P40 — published announcements for the notice banner
  getAnnouncements(): Promise<{ announcements: Announcement[] }> {
    return request("/pharmacy/announcements");
  },

  // P42 — order search (id fragment, customer name, phone)
  searchOrders(q: string): Promise<{ orders: Order[] }> {
    return request(`/pharmacy/orders/search?q=${encodeURIComponent(q)}`);
  },

  // P43 — pharmacy flags for admin refund approval; decide is admin-only
  createRefundRequest(orderId: string, reason: string): Promise<{ request: RefundRequest }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/refund-request`, {
      method: "POST",
      body: j({ reason }),
    });
  },
  listRefundRequests(status?: RefundRequest["status"]): Promise<{ requests: RefundRequest[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return request(`/pharmacy/refund-requests${q}`);
  },
  decideRefundRequest(id: string, approved: boolean): Promise<{ request: RefundRequest }> {
    return request(`/pharmacy/refund-requests/${encodeURIComponent(id)}/decide`, {
      method: "PATCH",
      body: j({ approved }),
    });
  },

  // P44 — non-dispatch days
  listHolidays(): Promise<{ holidays: DispatchHoliday[] }> {
    return request("/pharmacy/holidays");
  },
  createHoliday(input: { date: string; label: string }): Promise<{ holiday: DispatchHoliday }> {
    return request("/pharmacy/holidays", { method: "POST", body: j(input) });
  },
  deleteHoliday(id: string): Promise<{ deleted: boolean }> {
    return request(`/pharmacy/holidays/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  // P45 — courier damage claims
  listCourierClaims(status?: CourierClaim["status"]): Promise<{ claims: CourierClaim[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return request(`/pharmacy/courier-claims${q}`);
  },
  createCourierClaim(input: {
    courier_name: string;
    order_id?: string | null;
    amount_npr?: number;
    reason: string;
  }): Promise<{ claim: CourierClaim }> {
    return request("/pharmacy/courier-claims", { method: "POST", body: j(input) });
  },
  setCourierClaimStatus(id: string, status: CourierClaim["status"]): Promise<{ claim: CourierClaim }> {
    return request(`/pharmacy/courier-claims/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: j({ status }),
    });
  },
};
