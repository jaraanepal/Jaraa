/**
 * Scan draft persistence: every stage of an in-progress scan is saved to
 * localStorage so the user can leave and resume anywhere (flow doc G6).
 * Photos themselves are NOT stored here (too big) — only their server ids
 * and the consent state; captured-but-unuploaded photos live in memory.
 */
import type { AdaptivePath } from "./stage3";
import type { PinType, RedFlagType } from "../api/types";

export interface DraftPin {
  id: string;
  type: PinType;
  /** 0 (2 years ago) .. 100 (today) */
  pos: number;
  answers: Record<string, string>;
}

export interface ScanDraft {
  scanId: string | null;
  guest: boolean;
  stage: "kahani" | "lens" | "jara" | "root_map";
  pins: DraftPin[];
  answers: Record<string, string>;
  redFlags: RedFlagType[];
  medFlag: boolean;
  path: AdaptivePath;
  consentPhoto: boolean;
  consentId: string | null;
  uploadedAngles: Record<string, string>; // angle -> photo id
  updatedAt: string;
}

const KEY = "jaraa:scan:draft";

export const EMPTY_DRAFT: ScanDraft = {
  scanId: null,
  guest: true,
  stage: "kahani",
  pins: [],
  answers: {},
  redFlags: [],
  medFlag: false,
  path: "standard",
  consentPhoto: false,
  consentId: null,
  uploadedAngles: {},
  updatedAt: new Date().toISOString(),
};

export function loadDraft(): ScanDraft {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_DRAFT };
    const parsed = JSON.parse(raw) as Partial<ScanDraft>;
    return { ...EMPTY_DRAFT, ...parsed };
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function saveDraft(d: ScanDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...d, updatedAt: new Date().toISOString() }));
  } catch {
    /* storage full / private mode — the scan still works in memory */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Draft is resumable if it has any pins, answers, or uploads. */
export function draftHasProgress(d: ScanDraft): boolean {
  return d.pins.length > 0 || Object.keys(d.answers).length > 0 || Object.keys(d.uploadedAngles).length > 0;
}
