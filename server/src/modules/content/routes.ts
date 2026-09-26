// P-10/P-11: content library — published education articles + idempotent view
// counting. Clients pick their locale; untranslated fields stay null — the
// server never fills a missing translation with another locale's text.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, notFound } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import type { EducationArticle } from "../../db/types";

const ALL_ROLES = ["customer", "doctor", "admin", "pharmacy", "coach"] as const;

// The EducationArticle contract type only carries the en/ne columns; rows may
// also carry title_ro/body_ro/category (select *). Read defensively.
function toContractArticle(a: EducationArticle) {
  const raw = a as unknown as Record<string, unknown>;
  const opt = (v: unknown): string | null =>
    typeof v === "string" && v.length ? v : null;
  return {
    id: a.id,
    title_en: a.title_en,
    title_ne: a.title_ne,
    title_ro: opt(raw.title_ro),
    body_en: a.body_en,
    body_ne: a.body_ne,
    body_ro: opt(raw.body_ro),
    category: opt(raw.category),
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

export function contentRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireRole(...ALL_ROLES));

  // GET /content/feed?category= — published articles with view counts
  r.get("/feed", asyncHandler(async (req: AuthedRequest, res) => {
    const category = typeof req.query.category === "string" && req.query.category.trim()
      ? req.query.category.trim()
      : undefined;
    const articles = await store.listPublishedArticles(category);
    const out = [];
    for (const a of articles) {
      out.push({ ...toContractArticle(a), view_count: await store.getArticleViewCount(a.id) });
    }
    res.json({ articles: out });
  }));

  // POST /content/articles/:id/view — idempotent view record
  r.post("/articles/:id/view", asyncHandler(async (req: AuthedRequest, res) => {
    const published = await store.listPublishedArticles();
    if (!published.some((a) => a.id === req.params.id)) throw notFound("Not found.");
    await store.recordArticleView(req.params.id, req.user!.id);
    res.json({ viewed: true });
  }));

  return r;
}
