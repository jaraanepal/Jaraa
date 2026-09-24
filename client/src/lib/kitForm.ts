/**
 * Admin kit form helpers: validation + textarea parsing.
 * Pure, unit-tested.
 */
import type { KitUpsertPayload } from "../api/types";

export interface KitFormValues {
  name: string;
  description: string;
  priceNpr: string;
  category: string;
  stock: string;
  includedText: string;
  usageInstructions: string;
  isActive: boolean;
}

/** Split the "what's included" textarea into clean lines. */
export function parseIncluded(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Validate the form; returns the payload or the i18n key of the error. */
export function kitPayload(values: KitFormValues): KitUpsertPayload | { error: string } {
  const name = values.name.trim();
  const price = Number(values.priceNpr);
  if (!name || !Number.isFinite(price) || price <= 0) {
    return { error: "adminKits.invalid" };
  }
  const stockRaw = values.stock.trim();
  const stock = stockRaw === "" ? undefined : Math.max(0, Math.floor(Number(stockRaw)));
  return {
    name,
    description: values.description.trim() || undefined,
    price_npr: Math.round(price),
    category: values.category.trim() || undefined,
    stock: stockRaw === "" || !Number.isFinite(stock) ? undefined : stock,
    included: parseIncluded(values.includedText),
    usage_instructions: values.usageInstructions.trim() || undefined,
    is_active: values.isActive,
  };
}
