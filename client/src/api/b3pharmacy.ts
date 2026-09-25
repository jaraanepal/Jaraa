// Batch-3 (009) pharmacy API — P19–P27. Uses the exported request() only;
// local types live in this file. Auth/session handling comes from client.ts.
import { request } from "./client";
import type { Order } from "./types";

export type QuarantineStatus = "quarantined" | "released" | "written_off";

export interface QuarantineEntry {
  id: string;
  kit_id: string;
  qty: number;
  reason: string | null;
  status: QuarantineStatus;
  reported_by: string | null;
  created_at: string;
}

export interface ShiftSummary {
  date: string;
  handled: number;
  pending: number;
  cod_orders: number;
  handover_notes: Array<{ id: string; order_id: string; author_id: string | null; note: string; created_at: string }>;
}

export interface CourierRow {
  courier: string;
  orders: number;
  delivered: number;
}

export interface ReturnKitRow {
  kit_id: string;
  kit_name: string;
  returns: number;
  reasons: Record<string, number>;
}

export interface PackagingMaterial {
  id: string;
  name: string;
  qty: number;
  unit: string | null;
  low_threshold: number;
  updated_at: string;
}

export interface CodOrderRow {
  id: string;
  order_no: string;
  total_npr: number;
  status: string;
  collected: boolean;
}

export interface CodReconciliation {
  date: string;
  expected_npr: number;
  collected_npr: number;
  orders: CodOrderRow[];
}

export interface PharmacyKit {
  id: string;
  plan_id?: string | null;
  name: string;
  name_en?: string;
  name_ne?: string | null;
  total_npr: number;
  category?: string | null;
  images?: string[];
  stock?: number;
  low_stock_threshold?: number | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface OrderNote {
  id: string;
  order_id: string;
  author_id: string;
  note: string;
  created_at: string;
}

const j = (v: unknown) => JSON.stringify(v);

export const pharmacyB3Api = {
  // P19 — damaged-stock quarantine
  listQuarantine(status?: QuarantineStatus): Promise<{ entries: QuarantineEntry[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return request(`/pharmacy/quarantine${q}`);
  },
  createQuarantine(input: { kit_id: string; qty: number; reason?: string }): Promise<{ entry: QuarantineEntry }> {
    return request("/pharmacy/quarantine", { method: "POST", body: j(input) });
  },
  setQuarantineStatus(id: string, status: QuarantineStatus): Promise<{ entry: QuarantineEntry }> {
    return request(`/pharmacy/quarantine/${encodeURIComponent(id)}`, { method: "PATCH", body: j({ status }) });
  },

  // P20 — shift handover summary
  getShiftSummary(date?: string): Promise<ShiftSummary> {
    const q = date ? `?date=${encodeURIComponent(date)}` : "";
    return request(`/pharmacy/shift-summary${q}`);
  },

  // P21 — courier performance
  getCourierPerformance(): Promise<{ couriers: CourierRow[] }> {
    return request("/pharmacy/couriers/performance");
  },

  // P22 — return-rate analytics
  getReturnAnalytics(): Promise<{ kits: ReturnKitRow[] }> {
    return request("/pharmacy/returns/analytics");
  },

  // P23 — pick/pack timer
  packStart(orderId: string): Promise<{ order: Order }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/pack-start`, { method: "POST" });
  },
  packComplete(orderId: string): Promise<{ order: Order }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/pack-complete`, { method: "POST" });
  },

  // P24 — packaging materials
  listPackaging(): Promise<{ materials: PackagingMaterial[] }> {
    return request("/pharmacy/packaging");
  },
  createPackaging(input: { name: string; qty?: number; unit?: string; low_threshold?: number }): Promise<{ material: PackagingMaterial }> {
    return request("/pharmacy/packaging", { method: "POST", body: j(input) });
  },
  updatePackaging(id: string, patch: Partial<Pick<PackagingMaterial, "name" | "qty" | "unit" | "low_threshold">>): Promise<{ material: PackagingMaterial }> {
    return request(`/pharmacy/packaging/${encodeURIComponent(id)}`, { method: "PATCH", body: j(patch) });
  },
  deletePackaging(id: string): Promise<{ deleted: boolean }> {
    return request(`/pharmacy/packaging/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  // P25 — COD reconciliation
  getCodReconciliation(date?: string): Promise<CodReconciliation> {
    const q = date ? `?date=${encodeURIComponent(date)}` : "";
    return request(`/pharmacy/cod-reconciliation${q}`);
  },

  // P26 — low-stock threshold
  setKitThreshold(kitId: string, threshold: number): Promise<{ kit: PharmacyKit }> {
    return request(`/pharmacy/kits/${encodeURIComponent(kitId)}/threshold`, {
      method: "PATCH",
      body: j({ threshold }),
    });
  },

  // P27 — order internal notes
  listOrderNotes(orderId: string): Promise<{ notes: OrderNote[] }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/notes`);
  },
  addOrderNote(orderId: string, note: string): Promise<{ note: OrderNote }> {
    return request(`/pharmacy/orders/${encodeURIComponent(orderId)}/notes`, {
      method: "POST",
      body: j({ note }),
    });
  },
};
