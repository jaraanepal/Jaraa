// P-9: Jaraa AI — hair-health EDUCATION assistant with hard safety guardrails.
// Every assistant reply is built in ONE place (aiReply) so the medical
// disclosure can never be omitted by accident.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { env } from "../../env";
import {
  DISCLOSURE_EN,
  DISCLOSURE_NE,
  HANDOFF_TEXT_EN,
  HANDOFF_TEXT_NE,
  detectRedFlag,
  applyGuardrails,
} from "../../lib/aiGuardrails";

const SYSTEM_PROMPT =
  "You are Jaraa AI, a hair-health EDUCATION assistant. Educate only: explain concepts, routines, general care in plain words. " +
  "NEVER diagnose, never name a condition the user might have, never prescribe or recommend specific medication. " +
  "If the user describes symptoms, give general information and advise seeing a dermatologist. Keep replies under 150 words.";

const ALL_ROLES = ["customer", "doctor", "admin", "pharmacy", "coach"] as const;

// Single response builder for assistant replies — disclosures always present.
function aiReply(res: { json: (b: unknown) => unknown }, extra: Record<string, unknown>) {
  return res.json({
    disclosure_en: DISCLOSURE_EN,
    disclosure_ne: DISCLOSURE_NE,
    ...extra,
  });
}

async function ownConversation(deps: Deps, userId: string, conversationId: string) {
  const convs = await deps.store.listAiConversations(userId);
  return convs.find((c) => c.id === conversationId) ?? null;
}

export function aiRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireRole(...ALL_ROLES));

  // POST /ai/chat — education-only chat with red-flag handoff + guardrails
  r.post("/chat", asyncHandler(async (req: AuthedRequest, res) => {
    const { conversation_id, message } = req.body ?? {};
    const msg = typeof message === "string" ? message.trim() : "";
    if (!msg || msg.length > 2000) {
      throw badRequest("Request failed validation.", { field: "message" });
    }

    // 1. get-or-create conversation, verifying ownership
    let convId: string;
    if (conversation_id !== undefined && conversation_id !== null && String(conversation_id).trim() !== "") {
      const existing = await ownConversation(deps, req.user!.id, String(conversation_id));
      if (!existing) throw notFound("Conversation not found.");
      convId = existing.id;
    } else {
      convId = (await store.createAiConversation(req.user!.id)).id;
    }

    // 2. save the user message
    await store.addAiMessage(convId, "user", msg);

    // 3. red-flag check BEFORE any model call
    if (detectRedFlag(msg)) {
      await store.addAiMessage(convId, "assistant", HANDOFF_TEXT_EN, true);
      // human handoff: support ticket for the care team (fire-and-forget is
      // NOT acceptable here — a failed ticket must surface, so we await it)
      await store.createTicket({
        user_id: req.user!.id,
        subject: "AI red-flag handoff",
        body: msg.slice(0, 500),
      });
      return aiReply(res, {
        handoff: true,
        red_flagged: true,
        reply: HANDOFF_TEXT_EN,
        reply_ne: HANDOFF_TEXT_NE,
      });
    }

    // 4. model availability
    if (!env.geminiApiKey) {
      res.status(503).json({
        code: "ai_not_configured",
        message: "AI assistant is not configured yet. Please try again later.",
      });
      return;
    }

    // 5. call Gemini (education-only prompt), then apply output guardrails
    let raw = "";
    try {
      const gr = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(env.geminiApiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: msg }] }],
            generationConfig: { maxOutputTokens: 400 },
          }),
        },
      );
      if (!gr.ok) throw new Error(`gemini ${gr.status}`);
      const json = (await gr.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      raw = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
    } catch {
      res.status(502).json({ code: "ai_upstream_error", message: "AI service is unavailable right now. Please try again later." });
      return;
    }
    if (!raw.trim()) {
      res.status(502).json({ code: "ai_upstream_error", message: "AI service returned an empty response. Please try again later." });
      return;
    }
    const guarded = applyGuardrails(raw);
    await store.addAiMessage(convId, "assistant", guarded.text, false);
    return aiReply(res, {
      conversation_id: convId,
      reply: guarded.text,
      red_flagged: false,
      safe: guarded.safe,
    });
  }));

  // GET /ai/conversations — own list
  r.get("/conversations", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ conversations: await store.listAiConversations(req.user!.id) });
  }));

  // GET /ai/conversations/:id/messages — ownership verified
  r.get("/conversations/:id/messages", asyncHandler(async (req: AuthedRequest, res) => {
    const conv = await ownConversation(deps, req.user!.id, req.params.id);
    if (!conv) throw notFound("Conversation not found.");
    res.json({ conversation: conv, messages: await store.listAiMessages(conv.id) });
  }));

  return r;
}
