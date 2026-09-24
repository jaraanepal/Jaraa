import type { Request, Response, NextFunction } from "express";
import { verifyAccess } from "../lib/jwt";
import { unauthorized, forbidden } from "../http";
import type { Role } from "../db/types";

export interface AuthedUser { id: string; role: Role }
export interface AuthedRequest extends Request { user?: AuthedUser }

/** Optional auth: attaches req.user when a valid Bearer token is present. */
export function authOptional(jwtSecret: string) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (h?.startsWith("Bearer ")) {
      try {
        const c = verifyAccess(h.slice(7), jwtSecret);
        req.user = { id: c.sub, role: c.role };
      } catch { /* invalid token -> treated as anonymous */ }
    }
    next();
  };
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`This endpoint requires the ${roles.join(" or ")} role.`));
    }
    next();
  };
}
