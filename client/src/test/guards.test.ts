import { describe, expect, it } from "vitest";
import { checkAccess, dashboardPathFor, loginPathFor, matchRule } from "../lib/guards";
import type { GuardState } from "../lib/guards";
import type { Role } from "../api/types";

const anon: GuardState = { isAuthed: false, role: null };
const cust = (role: Role = "customer"): GuardState => ({ isAuthed: true, role });

describe("route guards — longest-prefix matching", () => {
  it("matches the longest rule prefix", () => {
    const r = matchRule("/doctor/case/abc123");
    expect(r).not.toBeNull();
    expect(r!.auth).toBe(true);
    expect(r!.roles).toContain("doctor");
  });

  it("matches exact roots and nested paths", () => {
    expect(matchRule("/")?.auth).toBe(true);
    expect(matchRule("/scan/xyz")?.guestAllowed).toBe(true);
    expect(matchRule("/scan/xyz/map")?.guestAllowed).toBe(true);
    expect(matchRule("/admin/flags")?.roles).toContain("admin");
  });

  it("returns null for unknown routes", () => {
    expect(matchRule("/no/such/route")).toBeNull();
  });

  it("scan funnel is open without auth (guest drafts)", () => {
    const r = matchRule("/scan/xyz");
    expect(r?.auth).toBe(false);
    expect(checkAccess(anon, "/scan/xyz")).toBe("allow");
    expect(checkAccess(anon, "/scan/xyz/map")).toBe("allow");
  });

  it("customer-only routes send anonymous users to login", () => {
    expect(checkAccess(anon, "/")).toBe("login");
    expect(checkAccess(anon, "/plan")).toBe("login");
    expect(checkAccess(anon, "/orders")).toBe("login");
    expect(checkAccess(anon, "/teleconsult")).toBe("login");
  });

  it("customers can reach their own routes", () => {
    expect(checkAccess(cust(), "/")).toBe("allow");
    expect(checkAccess(cust(), "/plan")).toBe("allow");
    expect(checkAccess(cust(), "/progress")).toBe("allow");
    expect(checkAccess(cust(), "/orders")).toBe("allow");
  });

  it("roles are exclusive across consoles", () => {
    expect(checkAccess(cust(), "/doctor")).toBe("forbidden");
    expect(checkAccess(cust(), "/admin")).toBe("forbidden");
    expect(checkAccess(cust("doctor"), "/doctor")).toBe("allow");
    expect(checkAccess(cust("admin"), "/admin")).toBe("allow");
    expect(checkAccess(cust("pharmacy"), "/pharmacy")).toBe("allow");
    expect(checkAccess(cust("coach"), "/coach")).toBe("allow");
    expect(checkAccess(cust(), "/coach")).toBe("allow"); // customers may view coach
    expect(checkAccess(cust("pharmacy"), "/doctor")).toBe("forbidden");
  });

  it("every role has at least one reachable console", () => {
    const roles: Role[] = ["customer", "doctor", "admin", "pharmacy", "coach"];
    const paths = ["/", "/doctor", "/admin", "/pharmacy", "/coach", "/scan/1", "/plan"];
    for (const role of roles) {
      const st = cust(role);
      const ok = paths.some((p) => checkAccess(st, p) === "allow");
      expect(ok, `no reachable route for role ${role}`).toBe(true);
    }
  });

  it("P-12 customer feature routes are customer-only", () => {
    for (const p of ["/habits", "/referral", "/wishlist", "/help", "/my-data", "/my-challenges"]) {
      expect(matchRule(p)?.roles, p).toEqual(["customer"]);
      expect(checkAccess(anon, p), p).toBe("login");
      expect(checkAccess(cust(), p), p).toBe("allow");
      expect(checkAccess(cust("doctor"), p), p).toBe("forbidden");
    }
  });

  it("P-12 doctor/admin sub-routes inherit console role prefixes", () => {
    expect(checkAccess(cust("doctor"), "/doctor/followups")).toBe("allow");
    expect(checkAccess(cust("doctor"), "/doctor/availability")).toBe("allow");
    expect(checkAccess(cust(), "/doctor/followups")).toBe("forbidden");
    for (const p of ["/admin/broadcast", "/admin/refunds", "/admin/sla", "/admin/verifications", "/admin/finance", "/admin/tickets", "/admin/articles", "/admin/kit-analytics"]) {
      expect(checkAccess(cust("admin"), p), p).toBe("allow");
      expect(checkAccess(cust(), p), p).toBe("forbidden");
    }
  });
});

describe("staff login routing (P3)", () => {
  it("sends unauthenticated staff-console visits to the role's own login", () => {
    expect(loginPathFor("/admin")).toBe("/admin/login");
    expect(loginPathFor("/admin/flags")).toBe("/admin/login");
    expect(loginPathFor("/doctor")).toBe("/doctor/login");
    expect(loginPathFor("/doctor/case/abc")).toBe("/doctor/login");
    expect(loginPathFor("/pharmacy")).toBe("/pharmacy/login");
    expect(loginPathFor("/coach")).toBe("/coach/login");
  });

  it("sends customer routes to the customer login", () => {
    expect(loginPathFor("/")).toBe("/login");
    expect(loginPathFor("/plan")).toBe("/login");
    expect(loginPathFor("/scan/xyz")).toBe("/login");
  });

  it("staff login pages are public (no auth required)", () => {
    for (const p of ["/admin/login", "/doctor/login", "/pharmacy/login", "/coach/login"]) {
      expect(matchRule(p)?.auth, p).toBe(false);
      expect(checkAccess(anon, p), p).toBe("allow");
    }
  });

  it("auth pages are public; /profile needs auth", () => {
    for (const p of ["/signup", "/forgot-password", "/reset-password"]) {
      expect(matchRule(p)?.auth, p).toBe(false);
    }
    expect(matchRule("/profile")?.auth).toBe(true);
    expect(checkAccess(anon, "/profile")).toBe("login");
    expect(checkAccess(cust("coach"), "/profile")).toBe("allow");
  });
});

describe("guest mode (P6)", () => {
  it("guests may reach the scan entry (/) and the scan flow", () => {
    expect(checkAccess(anon, "/", true)).toBe("allow"); // guest pass via draft/flag
    expect(checkAccess(anon, "/scan", true)).toBe("allow");
    expect(checkAccess(anon, "/scan/xyz", true)).toBe("allow");
    expect(checkAccess(anon, "/scan/xyz/map", true)).toBe("allow");
    expect(checkAccess(anon, "/scan/xyz/submit", true)).toBe("allow");
  });

  it("anonymous users without a guest draft still go to login for /", () => {
    expect(checkAccess(anon, "/")).toBe("login");
    expect(checkAccess(anon, "/plan")).toBe("login");
  });

  it("guests cannot reach staff consoles or customer-only pages", () => {
    expect(checkAccess(anon, "/admin", true)).toBe("login");
    expect(checkAccess(anon, "/plan", true)).toBe("login");
    expect(checkAccess(anon, "/orders", true)).toBe("login");
  });
});

describe("role-mismatch dashboard targets (P11)", () => {
  it("maps every role to its own dashboard for [Go back]", () => {
    expect(dashboardPathFor("customer")).toBe("/");
    expect(dashboardPathFor("doctor")).toBe("/doctor");
    expect(dashboardPathFor("admin")).toBe("/admin");
    expect(dashboardPathFor("pharmacy")).toBe("/pharmacy");
    expect(dashboardPathFor("coach")).toBe("/coach");
  });

  it("every dashboard is reachable by its own role", () => {
    const roles: Role[] = ["customer", "doctor", "admin", "pharmacy", "coach"];
    for (const role of roles) {
      expect(checkAccess(cust(role), dashboardPathFor(role)), `role ${role}`).toBe("allow");
    }
  });

  it("a logged-in user on another role's console is forbidden (mismatch screen)", () => {
    // Guard renders RoleMismatchPage for these instead of redirecting.
    expect(checkAccess(cust(), "/admin")).toBe("forbidden");
    expect(checkAccess(cust("admin"), "/")).toBe("forbidden");
    expect(checkAccess(cust("doctor"), "/pharmacy")).toBe("forbidden");
    expect(checkAccess(cust("pharmacy"), "/coach")).toBe("forbidden");
  });

  it("P-17: /notifications is an authenticated route for every signed-in role", () => {
    const rule = matchRule("/notifications");
    expect(rule).not.toBeNull();
    expect(rule!.auth).toBe(true);
    expect(rule!.roles).toBeUndefined(); // no role restriction
    expect(checkAccess(anon, "/notifications")).toBe("login");
    const roles: Role[] = ["customer", "doctor", "admin", "pharmacy", "coach"];
    for (const role of roles) {
      expect(checkAccess(cust(role), "/notifications"), `role ${role}`).toBe("allow");
    }
  });

  it("P-18: admins may open the doctor case view from Submitted reviews", () => {
    expect(checkAccess(cust("doctor"), "/doctor/case/abc123")).toBe("allow");
    expect(checkAccess(cust("admin"), "/doctor/case/abc123")).toBe("allow");
    expect(checkAccess(cust(), "/doctor/case/abc123")).toBe("forbidden");
    expect(checkAccess(anon, "/doctor/case/abc123")).toBe("login");
  });
});
