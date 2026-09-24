/**
 * Route-guard logic (pure, unit-tested).
 * Roles come from GET /me/profile. Anything not explicitly allowed -> 403.
 */
import type { Role } from "../api/types";

export type Access = "allow" | "login" | "forbidden";

export interface GuardState {
  isAuthed: boolean;
  role: Role | null;
  /** guest drafts are allowed on these routes without auth */
  guestAllowed?: boolean;
}

export interface RouteRule {
  auth: boolean; // must be signed in (unless guestAllowed && guest draft exists)
  roles?: Role[]; // if set, role must be in this list
  guestAllowed?: boolean; // guests may pass (Kahani, login)
}

export const ROUTE_RULES: Record<string, RouteRule> = {
  "/login": { auth: false },
  "/": { auth: true, roles: ["customer"] },
  "/scan": { auth: false, guestAllowed: true }, // /scan/:id prefix
  "/plan": { auth: true, roles: ["customer"] },
  "/progress": { auth: true, roles: ["customer"] },
  "/kits": { auth: false },
  "/orders": { auth: true, roles: ["customer"] },
  "/teleconsult": { auth: true, roles: ["customer"] },
  "/doctor": { auth: true, roles: ["doctor"] }, // /doctor/* prefix
  "/admin": { auth: true, roles: ["admin"] }, // /admin/* prefix
  "/pharmacy": { auth: true, roles: ["pharmacy", "admin"] },
  "/coach": { auth: true, roles: ["customer", "coach"] },
};

export function matchRule(path: string): RouteRule | null {
  // Longest-prefix match so /scan/:id and /doctor/case/:id resolve.
  const keys = Object.keys(ROUTE_RULES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (path === k || path.startsWith(k + "/")) return ROUTE_RULES[k];
  }
  return null;
}

export function checkAccess(state: GuardState, path: string, hasGuestDraft = false): Access {
  const rule = matchRule(path);
  if (!rule) return "forbidden";
  if (!rule.auth) return "allow";
  if (state.isAuthed) {
    if (rule.roles && (!state.role || !rule.roles.includes(state.role))) return "forbidden";
    return "allow";
  }
  // Not authed: guest drafts may pass guestAllowed routes.
  if (rule.guestAllowed && hasGuestDraft) return "allow";
  return "login";
}
