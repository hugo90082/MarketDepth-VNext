import { normalizeDepthLabel } from "./indicator-mode.js";

export const SETTINGS_SCHEMA_VERSION = 2;
export const RULE_LIMIT = 200;
export const HISTORY_LIMIT = 200;
export const ALERT_REPEAT_SECONDS = 60;
export const GENERIC_RULE_KINDS = Object.freeze(["above", "below", "cross-up", "cross-down"]);
export const DEFAULT_LEVELS = Object.freeze({ level1: 0.1, level2: 0.2, level3: 0.4 });

/** @param {number} now @param {string} source */
export function createDepthProfile(now = Date.now(), source = "extension") {
  return {
    levels: { ...DEFAULT_LEVELS },
    revision: 0,
    updatedAt: now,
    source,
  };
}

/** @param {number} now */
export function createDefaultState(now = Date.now()) {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: 0,
    updatedAt: now,
    rules: [],
    preferences: {
      paused: false,
      notificationsEnabled: false,
      builtInDefaultsVersion: 0,
      onboarding: { pinned: false, notificationsChecked: false, soundChecked: false },
    },
    pinnedPage: null,
    depthProfile: createDepthProfile(now),
    pendingRuleTemplates: [],
    history: [],
    historyRevision: 0,
    ruleStates: {},
    dormantRecovery: { lastReloadAt: 0, signature: "" },
  };
}

/** @param {unknown} value @param {string} label */
function requiredFinite(value, label) {
  if (value === "" || value === null || value === undefined) throw new Error(`${label}必須是有效數值`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}必須是有效數值`);
  return number;
}

/** @param {any} value */
export function normalizeLevels(value) {
  const levels = {
    level1: requiredFinite(value?.level1, "第一段"),
    level2: requiredFinite(value?.level2, "第二段"),
    level3: requiredFinite(value?.level3, "第三段"),
  };
  if (!(levels.level1 > 0 && levels.level1 < levels.level2 && levels.level2 < levels.level3 && levels.level3 <= 0.7)) {
    throw new Error("門檻必須符合 0 < 第一段 < 第二段 < 第三段 ≤ 0.7");
  }
  return levels;
}

/** @param {any} input */
function normalizeTargetMeta(input) {
  if (!input || typeof input !== "object") return null;
  return {
    symbol: String(input.symbol ?? "").slice(0, 30),
    exchange: String(input.exchange ?? "").slice(0, 60),
    interval: String(input.interval ?? "").slice(0, 30),
    indicator: String(input.indicator ?? "").slice(0, 240),
    params: String(input.params ?? "").slice(0, 160),
    output: String(input.output ?? "").slice(0, 160),
    displayLabel: String(input.displayLabel ?? "").slice(0, 260),
  };
}

/** @param {any} input */
export function normalizeRule(input) {
  if (!input || typeof input !== "object") throw new Error("提醒規則格式錯誤");
  const common = {
    id: String(input.id ?? "").slice(0, 80),
    mode: input.mode,
    enabled: input.enabled !== false,
    targetKey: String(input.targetKey ?? "").slice(0, 600),
    unit: input.unit === "%" ? "%" : "number",
    soundEnabled: input.soundEnabled !== false,
    targetMeta: normalizeTargetMeta(input.targetMeta),
  };
  if (!common.id || !common.targetKey) throw new Error("提醒規則缺少識別資料");

  if (input.mode === "generic") {
    const kind = String(input.condition?.kind ?? "");
    if (!GENERIC_RULE_KINDS.includes(kind)) throw new Error("不支援的一般提醒條件");
    return {
      ...common,
      mode: "generic",
      condition: { kind, threshold: requiredFinite(input.condition?.threshold, "門檻") },
    };
  }
  if (input.mode !== "depth-ratio") throw new Error("不支援的提醒規則模式");
  const depthLabel = normalizeDepthLabel(input.depthLabel);
  if (depthLabel === null) throw new Error("請選擇有效的深度標籤");
  const levels = normalizeLevels(input.levels ?? DEFAULT_LEVELS);
  const custom = input.custom === true;
  const splitSides = custom && input.splitSides === true;
  return {
    ...common,
    mode: "depth-ratio",
    depthLabel,
    custom,
    splitSides,
    levels,
    buyLevels: normalizeLevels(input.buyLevels ?? levels),
    sellLevels: normalizeLevels(input.sellLevels ?? levels),
    notificationEnabled: input.notificationEnabled !== false,
  };
}

/** @param {Array<any>} rules @param {any} candidate */
export function depthLabelConflict(rules, candidate) {
  if (candidate?.mode !== "depth-ratio") return false;
  const symbol = String(candidate?.targetMeta?.symbol ?? "").toUpperCase();
  const depthLabel = normalizeDepthLabel(candidate?.depthLabel);
  if (!symbol || depthLabel === null) return false;
  return (rules ?? []).some((rule) => rule?.mode === "depth-ratio"
    && rule.id !== candidate.id
    && String(rule?.targetMeta?.symbol ?? "").toUpperCase() === symbol
    && Number(rule.depthLabel) === depthLabel);
}

/** @param {any} input @param {number} now */
export function normalizeDepthProfile(input, now = Date.now()) {
  try {
    return parseDepthProfile(input, now);
  } catch {
    return createDepthProfile(now);
  }
}

/** 嚴格驗證外部傳入的共用門檻，避免無效資料被靜默改成預設值。 */
export function parseDepthProfile(/** @type {any} */ input, now = Date.now()) {
  if (!input || typeof input !== "object") throw new Error("共用門檻資料格式不正確");
  if (!Number.isFinite(Number(input.updatedAt)) || Number(input.updatedAt) < 0) throw new Error("共用門檻時間不正確");
  if (!["extension", "test-site", "production-site"].includes(input.source)) throw new Error("共用門檻來源不正確");
  return {
    levels: normalizeLevels(input.levels),
    revision: Math.max(0, Math.trunc(Number(input.revision) || 0)),
    updatedAt: Number(input.updatedAt) || now,
    source: input.source,
  };
}

/** @param {any} source */
function normalizePreferences(source) {
  const preferences = source && typeof source === "object" ? source : {};
  return {
    paused: preferences.paused === true,
    notificationsEnabled: preferences.notificationsEnabled === true,
    builtInDefaultsVersion: Math.max(0, Math.trunc(Number(preferences.builtInDefaultsVersion) || 0)),
    onboarding: {
      pinned: preferences.onboarding?.pinned === true,
      notificationsChecked: preferences.onboarding?.notificationsChecked === true,
      soundChecked: preferences.onboarding?.soundChecked === true,
    },
  };
}

/** @param {unknown} value */
function normalizePendingRuleTemplates(value) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const templateId = String(candidate.templateId ?? "").slice(0, 120);
    const target = candidate.target && typeof candidate.target === "object" ? candidate.target : null;
    const rule = candidate.rule && typeof candidate.rule === "object" ? candidate.rule : null;
    if (!templateId || !target || !rule) continue;
    entries.push({ templateId, target: { ...target }, rule: { ...rule } });
    if (entries.length >= RULE_LIMIT) break;
  }
  return entries;
}

/** @param {any} value */
function normalizePinnedPage(value) {
  return value && typeof value === "object"
    ? { url: String(value.url ?? "").slice(0, 1_000), title: String(value.title ?? "").slice(0, 200) }
    : null;
}

/** @param {unknown} candidate @param {number} now */
export function normalizeSettingsBackup(candidate, now = Date.now()) {
  if (!candidate || typeof candidate !== "object") throw new Error("設定備份格式錯誤");
  const source = /** @type {Record<string, any>} */ (candidate);
  const legacy = Number(source.schemaVersion) !== SETTINGS_SCHEMA_VERSION;
  const depthProfile = legacy ? createDepthProfile(0) : normalizeDepthProfile(source.depthProfile, now);
  const rules = [];
  if (!legacy) {
    for (const candidateRule of Array.isArray(source.rules) ? source.rules : []) {
      const normalized = /** @type {any} */ (normalizeRule(candidateRule));
      if (normalized.mode === "depth-ratio" && normalized.custom !== true) {
        rules.push({
          ...normalized,
          custom: true,
          splitSides: false,
          levels: { ...depthProfile.levels },
          buyLevels: { ...depthProfile.levels },
          sellLevels: { ...depthProfile.levels },
        });
      } else {
        rules.push(normalized);
      }
      if (rules.length >= RULE_LIMIT) break;
    }
  }
  const ids = new Set();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error("設定備份包含重複規則 ID");
    if (depthLabelConflict(rules.filter((item) => item.id !== rule.id), rule)) {
      throw new Error("同商品不可使用重複深度標籤");
    }
    ids.add(rule.id);
  }
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: Math.max(0, Math.trunc(Number(source.revision) || 0)) + (legacy ? 1 : 0),
    updatedAt: legacy ? now : Number(source.updatedAt) || now,
    rules,
    preferences: normalizePreferences(source.preferences),
    pinnedPage: normalizePinnedPage(source.pinnedPage),
    depthProfile,
    pendingRuleTemplates: legacy ? [] : normalizePendingRuleTemplates(source.pendingRuleTemplates),
  };
}

/** @param {string} value */
export function checksumText(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** @param {any} state @param {number} now */
export function exportSettingsBackup(state, now = Date.now()) {
  const normalized = normalizeSettingsBackup({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: Number(state?.revision) || 0,
    updatedAt: now,
    rules: state?.rules ?? [],
    preferences: state?.preferences ?? {},
    pinnedPage: state?.pinnedPage
      ? { url: state.pinnedPage.url, title: state.pinnedPage.title }
      : null,
    depthProfile: state?.depthProfile,
    pendingRuleTemplates: state?.pendingRuleTemplates ?? [],
  }, now);
  return { ...normalized, checksum: checksumText(JSON.stringify(normalized)) };
}

/** @param {Array<any>} current @param {Array<any>} entries */
export function appendHistory(current, entries) {
  const byId = new Map();
  for (const entry of [...(current ?? []), ...(entries ?? [])]) {
    if (!entry || typeof entry.id !== "string" || !Number.isFinite(entry.time)) continue;
    byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => a.time - b.time).slice(-HISTORY_LIMIT);
}
