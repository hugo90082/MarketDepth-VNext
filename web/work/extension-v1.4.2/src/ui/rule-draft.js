import { parseDisplayNumber } from "../lib/number.js";
import { normalizeLevels } from "../lib/settings.js";

export class RuleDraftError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "RuleDraftError";
    this.field = field;
  }
}

export function clearDraftFieldError(input) { input?.removeAttribute("aria-invalid"); }
export function markDraftFieldError(input) { input?.setAttribute("aria-invalid", "true"); input?.focus(); }

export function parseThreshold(raw, unit, field = "threshold") {
  const text = String(raw ?? "").trim();
  if (!text) throw new RuleDraftError("請輸入門檻", field);
  const parsed = parseDisplayNumber(unit === "%" && !text.includes("%") ? `${text}%` : text);
  if (!parsed || parsed.unit !== unit) throw new RuleDraftError(`請輸入有效的${unit === "%" ? "百分比" : "數值"}門檻`, field);
  return parsed.value;
}

export function validateGenericDraft(draft) {
  const kinds = ["above", "below", "cross-up", "cross-down"];
  if (!kinds.includes(draft.kind)) throw new RuleDraftError("請選擇有效的提醒條件", "kind");
  return { kind: draft.kind, threshold: parseThreshold(draft.thresholdRaw, draft.unit, "threshold") };
}

export function validateLevelDraft(values, field = "levels") {
  try { return normalizeLevels(values); }
  catch (error) { throw new RuleDraftError(error instanceof Error ? error.message : "門檻設定不正確", field); }
}
