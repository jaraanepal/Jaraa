// Coach nudges — pure, rule-based generator from the customer's latest root
// scores and re-scan date. No AI, no medical claims: habit framing only.
export interface NudgeInput {
  weakestRoots: string[]; // root keys, weakest first
  rescanDueOn: string | null;
  daysSinceLastCheckin: number | null;
}

export interface Nudge { id: string; kind: string; title_en: string; title_ne: string }

const ROOT_NUDGES: Record<string, { en: string; ne: string }> = {
  nutrition: { en: "Add one protein-rich meal today — dal, eggs, or soy.", ne: "आज प्रोटिनयुक्त एउटा खाना थप्नुहोस् — दाल, अण्डा वा भटमास।" },
  stress_sleep: { en: "Lights out 30 minutes earlier tonight 🌙", ne: "आज ३० मिनेट चाँडै सुत्नुहोस् 🌙" },
  hormones: { en: "Your cycle notes help your dermatologist — log any changes.", ne: "तपाईंको चक्र नोटले डाक्टरलाई मद्दत गर्छ — परिवर्तन टिप्नुहोस्।" },
  scalp: { en: "Gentle scalp massage before your next wash — no nails.", ne: "अर्को नुहाउनुअघि हल्का टाउको मालिस — नङले होइन।" },
  damage: { en: "Skip heat styling this week; let hair air-dry once.", ne: "यो हप्ता तातो स्टाइलिङ नगर्नुहोस्; एकपटक हावामै सुकाउनुहोस्।" },
  medical_family: { en: "Keep taking prescribed medicines regularly — consistency matters.", ne: "तोकिएको औषधि नियमित खानुहोस् — निरन्तरता महत्वपूर्ण छ।" },
};

export function buildNudges(input: NudgeInput): Nudge[] {
  const nudges: Nudge[] = [];
  for (const root of input.weakestRoots.slice(0, 2)) {
    const t = ROOT_NUDGES[root];
    if (t) nudges.push({ id: `nudge-${root}`, kind: "root", title_en: t.en, title_ne: t.ne });
  }
  if (input.daysSinceLastCheckin === null || input.daysSinceLastCheckin >= 30) {
    nudges.push({
      id: "nudge-checkin", kind: "checkin",
      title_en: "Monthly check-in is due — how is the shedding this week?",
      title_ne: "मासिक चेक-इन बाँकी छ — यो हप्ता कपाल झर्ने कस्तो छ?",
    });
  }
  if (input.rescanDueOn) {
    const due = new Date(input.rescanDueOn).getTime();
    const days = Math.ceil((due - Date.now()) / 86_400_000);
    if (days >= 0 && days <= 14) {
      nudges.push({
        id: "nudge-rescan", kind: "rescan",
        title_en: `Re-scan due in ${days} day${days === 1 ? "" : "s"} — compare your roots.`,
        title_ne: `${days} दिनमा पुनः स्क्यान — आफ्ना रुटहरू तुलना गर्नुहोस्।`,
      });
    }
  }
  return nudges;
}
