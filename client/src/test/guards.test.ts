import { describe, expect, it } from "vitest";
import { checkAccess, matchRule } from "../lib/guards";
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
});
