import { depthLabelConflict, normalizeRule, RULE_LIMIT } from "./settings.js";

/** @param {unknown} value @param {number} max */
function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

/** @param {any} value */
function normalizeIdentity(value) {
  if (!value || typeof value !== "object") return null;
  const identity = {
    symbol: cleanText(value.symbol, 30).toUpperCase(),
    interval: cleanText(value.interval, 30),
    indicator: cleanText(value.indicator, 240),
    params: cleanText(value.params, 160),
    output: cleanText(value.output, 160),
    outputIndex: Math.max(0, Math.trunc(Number(value.outputIndex) || 0)),
    unit: value.unit === "%" ? "%" : "number",
    paneOrdinal: Number.isInteger(Number(value.paneOrdinal)) && Number(value.paneOrdinal) >= 0
      ? Number(value.paneOrdinal)
      : null,
  };
  if (!identity.symbol || !identity.interval || !identity.indicator) return null;
  return identity;
}

/** @param {any} value */
function normalizeEntry(value) {
  if (!value || typeof value !== "object") return null;
  const templateId = cleanText(value.templateId, 120);
  const target = normalizeIdentity(value.target);
  const rule = value.rule && typeof value.rule === "object" ? { ...value.rule } : null;
  if (!templateId || !target || !rule || !["depth-ratio", "generic"].includes(rule.mode)) return null;
  return { templateId, target, rule };
}

/** @param {any} value */
export function normalizePortableRuleTemplate(value) {
  if (!value || typeof value !== "object" || Number(value.templateVersion) !== 1 || !Array.isArray(value.rules)) {
    throw new Error("預設規則範本格式不正確");
  }
  const rules = value.rules.map(normalizeEntry).filter(Boolean).slice(0, RULE_LIMIT);
  if (!rules.length) throw new Error("預設規則範本沒有可用規則");
  return { templateVersion: 1, rules };
}

/** @param {any} identity @param {any} target */
function identityMatches(identity, target) {
  return String(target?.symbol ?? "").toUpperCase() === identity.symbol
    && String(target?.interval ?? "") === identity.interval
    && String(target?.indicator ?? "") === identity.indicator
    && String(target?.params ?? "") === identity.params
    && String(target?.output ?? "") === identity.output
    && Number(target?.outputIndex ?? 0) === identity.outputIndex
    && (target?.unit === "%" ? "%" : "number") === identity.unit
    && (identity.paneOrdinal === null || Number(target?.paneOrdinal) === identity.paneOrdinal);
}

/** @param {any} entry @param {any} target @param {()=>string} idFactory */
function createRule(entry, target, idFactory) {
  return normalizeRule({
    ...entry.rule,
    id: idFactory(),
    custom: entry.rule.mode === "depth-ratio" ? true : undefined,
    targetKey: target.key,
    unit: target.unit,
    targetMeta: target,
  });
}

/** @param {any} entry @param {any[]} catalog */
function matchEntry(entry, catalog) {
  const matches = (Array.isArray(catalog) ? catalog : []).filter((target) => identityMatches(entry.target, target));
  return matches.length === 1 ? matches[0] : null;
}

/** @param {any[]} rules @param {any} entry @param {any} target @param {()=>string} idFactory */
function appendResolvedRule(rules, entry, target, idFactory) {
  const rule = createRule(entry, target, idFactory);
  if (rules.length >= RULE_LIMIT || depthLabelConflict(rules, rule)) return false;
  rules.push(rule);
  return true;
}

/** @param {{pending:any[],rules:any[],catalog:any[],idFactory?:()=>string}} input */
export function resolvePendingRuleTemplates({ pending, rules, catalog, idFactory = () => crypto.randomUUID() }) {
  const nextRules = [...(Array.isArray(rules) ? rules : [])];
  const nextPending = [];
  let matchedCount = 0;
  for (const candidate of Array.isArray(pending) ? pending : []) {
    const entry = normalizeEntry(candidate);
    if (!entry) continue;
    const target = matchEntry(entry, catalog);
    if (!target || !appendResolvedRule(nextRules, entry, target, idFactory)) {
      nextPending.push(entry);
      continue;
    }
    matchedCount += 1;
  }
  return { rules: nextRules, pending: nextPending, matchedCount };
}

/** @param {{template:any,rules:any[],pending:any[],catalog:any[],alreadyApplied:boolean,idFactory?:()=>string}} input */
export function applyPortableRuleTemplate({ template, rules, pending, catalog, alreadyApplied, idFactory = () => crypto.randomUUID() }) {
  if (alreadyApplied || (Array.isArray(rules) && rules.length) || (Array.isArray(pending) && pending.length)) {
    throw new Error("預設規則只提供給首次使用且尚無規則的插件");
  }
  const normalized = normalizePortableRuleTemplate(template);
  const resolved = resolvePendingRuleTemplates({ pending: normalized.rules, rules: [], catalog, idFactory });
  return {
    applied: true,
    alreadyApplied: true,
    rules: resolved.rules,
    pending: resolved.pending,
    matchedCount: resolved.matchedCount,
    pendingCount: resolved.pending.length,
  };
}
