import type { Request, Response, NextFunction } from "express";

// Contract error envelope: {code, message, details?}
export type ErrorCode =
  | "feature_disabled" | "red_flag_unresolved" | "scan_incomplete" | "rate_limited"
  | "validation_error" | "unauthorized" | "forbidden" | "not_found" | "conflict"
  | "consent_required" | "guest_forbidden" | "signature_invalid" | "not_ready";

export class HttpError extends Error {
  constructor(public status: number, public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "validation_error", msg, details);
export const unauthorized = (msg = "Authentication required.") => new HttpError(401, "unauthorized", msg);
export const forbidden = (msg = "Forbidden.") => new HttpError(403, "forbidden", msg);
export const notFound = (msg = "Not found.") => new HttpError(404, "not_found", msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, "conflict", msg, details);
export const featureDisabled = (msg: string, details?: unknown) => new HttpError(403, "feature_disabled", msg, details);

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    const body: Record<string, unknown> = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    res.status(err.status).json(body);
    return;
  }
  // multer file-size errors -> 413 per contract
  const e = err as { code?: string; message?: string };
  if (e?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ code: "validation_error", message: "Photo exceeds 8 MB after compression." });
    return;
  }
  console.error("[unhandled]", err);
  res.status(500).json({ code: "validation_error", message: "Internal error." });
}

// minimal cookie parser (avoids an extra dependency)
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.ip ?? "unknown";
}
