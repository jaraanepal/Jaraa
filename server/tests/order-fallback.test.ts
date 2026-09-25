// P-14: order insert must degrade when the deploy DB hasn't run migration 008
// (delivery_instructions / coupon_code / discount_npr columns missing).
import { describe, it, expect, vi } from "vitest";
import { SupabaseStore } from "../src/db/supabase";

const orderInput = {
  order_no: "JR-TEST-1", user_id: "u1", kit_id: "k1",
  subtotal_npr: 1000, shipping_npr: 120, total_npr: 1120,
  payment_method: "cod", idempotency_key: "key-1",
  shipping_address: { name: "Aasha", phone: "+9779841234601", city: "Kathmandu", address_line: "Boudha 12" },
  delivery_instructions: "ring twice", coupon_code: null, discount_npr: 0,
};

/** Fake supabase-js chain: .from().insert().select().single() */
function fakeSb(insertImpl: (payload: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
  const calls: Record<string, unknown>[] = [];
  const single = (payload: Record<string, unknown>) => insertImpl(payload);
  const select = () => ({ single: () => single(lastPayload) });
  let lastPayload: Record<string, unknown> = {};
  const insert = (payload: Record<string, unknown>) => { lastPayload = payload; calls.push(payload); return { select }; };
  return { sb: { from: () => ({ insert }) }, calls };
}

describe("SupabaseStore.createOrder — missing 008 columns fallback", () => {
  it("inserts with additive columns when they exist", async () => {
    const store = Object.create(SupabaseStore.prototype);
    const { sb, calls } = fakeSb(async () => ({ data: { id: "o1" }, error: null }));
    store.sb = sb;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await store.createOrder(orderInput);
    expect(out).toEqual({ id: "o1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveProperty("delivery_instructions", "ring twice");
    (console.warn as unknown as { mockRestore: () => void }).mockRestore();
  });

  it("retries without additive columns when PostgREST reports unknown column", async () => {
    const store = Object.create(SupabaseStore.prototype);
    let n = 0;
    const { sb, calls } = fakeSb(async () => {
      n += 1;
      if (n === 1) {
        return { data: null, error: { code: "PGRST204", message: 'Could not find the \'delivery_instructions\' column of \'orders\' in the schema cache' } };
      }
      return { data: { id: "o2" }, error: null };
    });
    store.sb = sb;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await store.createOrder(orderInput);
    expect(out).toEqual({ id: "o2" });
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toHaveProperty("delivery_instructions");
    expect(calls[1]).not.toHaveProperty("coupon_code");
    expect(calls[1]).not.toHaveProperty("discount_npr");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still throws genuine errors (not masked by the fallback)", async () => {
    const store = Object.create(SupabaseStore.prototype);
    const { sb } = fakeSb(async () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }));
    store.sb = sb;
    await expect(store.createOrder(orderInput)).rejects.toMatchObject({ code: "23505" });
  });
});
