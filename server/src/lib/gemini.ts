// Gemini photo-QUALITY check — constrained strictly to capture-quality signals.
// This module NEVER produces diagnostic or condition labels and must never be
// used for medical assessment: the dermatologist makes all medical decisions.
// Without GEMINI_API_KEY the check is skipped ({skipped:true}).
export type AngleMatch = "hairline" | "crown" | "parting" | "temples" | "shedding" | "unclear";

export interface QualityResult {
  lighting_ok?: boolean;
  blur_ok?: boolean;
  angle_match?: AngleMatch;
  face_visible?: boolean;
  notes?: string;
  skipped?: boolean;
}

const FORBIDDEN = [
  "alopecia", "diagnos", "telogen", "anagen", "dandruff", "seborrheic", "psoriasis",
  "infection", "fungal", "condition", "disease", "treatment", "prescri",
];

export function buildQualityPrompt(angle: string): string {
  return `You are a photo capture-quality checker for a hair-health app. ` +
    `Look at this photo and return ONLY a JSON object with these fields, nothing else:\n` +
    `{"lighting_ok": boolean (is the scalp area well-lit, not too dark or blown out),\n` +
    `"blur_ok": boolean (is the image sharp, not blurry),\n` +
    `"angle_match": one of "hairline"|"crown"|"parting"|"temples"|"shedding"|"unclear" (which scalp angle does the photo actually show; expected angle is "${angle}"),\n` +
    `"face_visible": boolean (is a human face clearly visible),\n` +
    `"notes": string (one short sentence of capture advice, e.g. "move nearer a window")}\n` +
    `STRICT RULES: Do NOT identify any medical condition, disease, diagnosis, or treatment. ` +
    `Do NOT comment on hair loss, scalp health, or what the photo shows medically. ` +
    `Assess ONLY lighting, sharpness, framing angle, and face visibility.`;
}

export function promptIsQualityOnly(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  // allowed only as explicit prohibitions ("do not identify any medical condition")
  const stripped = lower.replace(/do not[^.]*\./g, "");
  return !FORBIDDEN.some((w) => stripped.includes(w));
}

export async function checkPhotoQuality(thumbBytes: Buffer, angle: string): Promise<QualityResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { skipped: true };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: buildQualityPrompt(angle) },
            { inline_data: { mime_type: "image/jpeg", data: thumbBytes.toString("base64") } },
          ] }],
          generationConfig: { response_mime_type: "application/json" },
        }),
      },
    );
    if (!res.ok) return { skipped: true };
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text) as QualityResult;
    return {
      lighting_ok: !!parsed.lighting_ok,
      blur_ok: !!parsed.blur_ok,
      angle_match: parsed.angle_match ?? "unclear",
      face_visible: !!parsed.face_visible,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : undefined,
    };
  } catch {
    return { skipped: true };
  }
}
