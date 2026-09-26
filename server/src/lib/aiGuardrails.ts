// P-9: AI assistant safety core — education-only guardrails, independent of any
// model. This file never calls a network: it is pure text classification and
// response sanitization, so the rules hold even if the model provider changes.
export const DISCLOSURE_EN =
  "Jaraa AI is an educational assistant, not a medical professional. This information is for learning only and is not a diagnosis. Please consult a qualified dermatologist for medical advice.";

export const DISCLOSURE_NE =
  "जरा AI शैक्षिक सहायक हो, चिकित्सक होइन। यो जानकारी सिकाइका लागि मात्र हो, निदान होइन। चिकित्सा सल्लाहका लागि योग्य छाला रोग विशेषज्ञसँग परामर्श लिनुहोस्।";

// Self-harm / severe-symptom signals that trigger the human handoff (en + roman-ne).
// Kept as simple substring patterns on purpose: false positives are cheap
// (a human reviews the handoff), false negatives are not.
export const RED_FLAG_PATTERNS: RegExp[] = [
  /kill myself/i,
  /suicide/i,
  /self[\s-]?harm/i,
  /i want to die/i,
  /end my life/i,
  /marna chahanchhu/i,
  /atmahatya/i,
  /bleeding scalp/i,
  /scalp infection spreading/i,
  /\bpus\b/i,
  /severe pain/i,
  /sudden bald patches overnight/i,
];

export function detectRedFlag(text: string): boolean {
  const t = typeof text === "string" ? text : "";
  return RED_FLAG_PATTERNS.some((re) => re.test(t));
}

// Language the assistant must never emit: diagnosis, condition naming, prescribing.
export const DENY_PATTERNS: RegExp[] = [
  /it sounds like you (might|may) have/i,
  /you have (alopecia|dermatitis|psoriasis|eczema|folliculitis|dandruff|seborrheic)/i,
  /diagnos(is|ed|ing)/i,
  /i (think|believe) you have/i,
  /your condition is/i,
  /prescrib/i,
];

const FALLBACK =
  "I can share general hair-health information, but I can't interpret symptoms or suggest a diagnosis. A dermatologist can give you a proper evaluation — would you like general information about a topic instead?";

export function applyGuardrails(llmText: string): { safe: boolean; text: string } {
  const t = typeof llmText === "string" ? llmText : "";
  if (DENY_PATTERNS.some((re) => re.test(t))) {
    return { safe: false, text: FALLBACK };
  }
  return { safe: true, text: t };
}

export const HANDOFF_TEXT_EN =
  "Thank you for sharing this with me. Some of what you described needs a human professional's attention, so I've paused the AI chat and asked our care team to reach out. If you feel you may act on thoughts of harming yourself, please contact local emergency services or a trusted person right away.";

export const HANDOFF_TEXT_NE =
  "Tapaisanga kura garnubhayeko ma dhanyabad. Tapainle bhannubhayeko kehi kura herne lagi hamro care team ko manchhe chahinchha, tyasaile maile AI chat roke ko chhu ra care team lai samparka garna bhane ko chhu. Yadi tapainlai afulai hani garne soch ayo bhane, kripaya turunta sthaniya emergency sewa wa bharosa ko manchhelai samparka garnuhos.";
