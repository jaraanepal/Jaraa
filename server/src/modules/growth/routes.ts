// P-13 + P-14: growth — referrals, coin rewards, and the customer wallet.
// NOTE: there is deliberately no cash-out/withdrawal — the wallet holds
// store credit (cashback, COD change) redeemable on Jaraa only, by design.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, forbidden, clientIp } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import type { WalletTxnKind } from "../../db/types";

export function growthRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  const customerOnly = requireRole("customer");
  const adminOnly = requireRole("admin");

  // GET /growth/referral (customer) — my code, coin balance, ledger
  r.get("/referral", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const code = await store.getOrCreateReferralCode(req.user!.id);
    res.json({
      code: code.code,
      coins: await store.getCoinBalance(req.user!.id),
      ledger: await store.listCoinLedger(req.user!.id, 20),
    });
  }));

  // POST /growth/referral/apply (customer) — apply someone else's code
  r.post("/referral/apply", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
    if (!code) throw badRequest("Request failed validation.", { field: "code" });
    const rc = await store.getReferralCode(code);
    if (!rc) throw notFound("Referral code not found.");
    if (rc.user_id === req.user!.id) {
      throw conflict("You cannot apply your own referral code.", { field: "code" });
    }
    const referral = await store.applyReferralCode(req.user!.id, code);
    res.status(201).json({ referral });
  }));

  // GET /growth/wallet (customer) — balance + transactions
  r.get("/wallet", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const wallet = await store.getOrCreateWallet(req.user!.id);
    res.json({
      balance_npr: wallet.balance_npr,
      txns: await store.listWalletTxns(req.user!.id, 50),
    });
  }));

  // POST /growth/wallet/cod-change (customer) — credit COD change to the wallet.
  // Only for the customer's own COD orders.
  r.post("/wallet/cod-change", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { order_id, amount_npr } = req.body ?? {};
    const amount = Number(amount_npr);
    if (!order_id || typeof order_id !== "string") throw badRequest("Request failed validation.", { field: "order_id" });
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
      throw badRequest("Request failed validation.", { field: "amount_npr" });
    }
    const order = (await store.getOrder(order_id)) ?? (await store.getOrderByNo(order_id));
    if (!order) throw notFound("Order not found.");
    if (order.user_id !== req.user!.id) {
      throw forbidden("This order does not belong to you.");
    }
    if (order.payment_method !== "cod") {
      throw badRequest("COD change can only be credited for cash-on-delivery orders.", { field: "order_id" });
    }
    const txn = await store.addWalletTxn(req.user!.id, amount, "cod_change", order.id);
    res.status(201).json({ txn });
  }));

  // POST /growth/wallet/grant (admin) — cashback / adjustment credit. Audit-logged.
  r.post("/wallet/grant", adminOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { user_id, amount_npr, kind, ref } = req.body ?? {};
    const amount = Number(amount_npr);
    if (!user_id || typeof user_id !== "string") throw badRequest("Request failed validation.", { field: "user_id" });
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
      throw badRequest("Request failed validation.", { field: "amount_npr" });
    }
    const k = String(kind);
    if (k !== "cashback" && k !== "adjustment") throw badRequest("Request failed validation.", { field: "kind" });
    const target = await store.getUserById(user_id);
    if (!target) throw notFound("User not found.");
    const txn = await store.addWalletTxn(
      target.id, amount, k as WalletTxnKind,
      typeof ref === "string" && ref.trim() ? ref.trim().slice(0, 200) : null,
    );
    await audit(store, {
      actorId: req.user!.id, action: "wallet.grant", entity: "wallet_txn",
      entityId: txn.id, ip: clientIp(req), detail: `${k} ${amount} NPR -> ${target.id}`,
    });
    res.status(201).json({ txn });
  }));

  // GET /growth/coins/ledger (customer)
  r.get("/coins/ledger", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({
      coins: await store.getCoinBalance(req.user!.id),
      ledger: await store.listCoinLedger(req.user!.id, 50),
    });
  }));

  return r;
}
