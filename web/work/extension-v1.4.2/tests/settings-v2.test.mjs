import assert from "node:assert/strict";
import test from "node:test";
import {
  SETTINGS_SCHEMA_VERSION,
  createDefaultState,
  depthLabelConflict,
  exportSettingsBackup,
  normalizeRule,
  normalizeSettingsBackup,
} from "../src/lib/settings.js";

const targetMeta = (symbol = "BTC") => ({
  symbol,
  exchange: "Binance",
  interval: "1",
  indicator: "聚合現貨訂單薄深度比值",
  params: "",
  output: "Ratio",
});

const depthRule = (id = "depth-1", symbol = "BTC", depthLabel = 10) => ({
  id,
  mode: "depth-ratio",
  enabled: true,
  targetKey: `target-${id}`,
  unit: "number",
  depthLabel,
  custom: false,
  splitSides: false,
  levels: { level1: 0.2, level2: 0.4, level3: 0.55 },
  buyLevels: { level1: 0.2, level2: 0.4, level3: 0.55 },
  sellLevels: { level1: 0.2, level2: 0.4, level3: 0.55 },
  soundEnabled: true,
  notificationEnabled: true,
  targetMeta: targetMeta(symbol),
});

test("新設定使用 schema v2 與三段全域門檻 profile", () => {
  const state = createDefaultState(100);
  assert.equal(SETTINGS_SCHEMA_VERSION, 2);
  assert.deepEqual(state.depthProfile, {
    levels: { level1: 0.1, level2: 0.2, level3: 0.4 },
    revision: 0,
    updatedAt: 100,
    source: "extension",
  });
  assert.deepEqual(state.dormantRecovery, { lastReloadAt: 0, signature: "" });
});

test("既有 schema v2 門檻與規則不因新預設而被重設", () => {
  const existingProfile = {
    levels: { level1: 0.15, level2: 0.35, level3: 0.6 },
    revision: 9,
    updatedAt: 500,
    source: "extension",
  };
  const normalized = normalizeSettingsBackup({
    schemaVersion: 2,
    revision: 12,
    updatedAt: 500,
    rules: [depthRule()],
    preferences: { notificationsEnabled: true },
    pinnedPage: null,
    depthProfile: existingProfile,
  }, 1_000);
  assert.deepEqual(normalized.depthProfile, existingProfile);
  assert.equal(normalized.rules.length, 1);
  assert.equal(normalized.rules[0].custom, true);
  assert.deepEqual(normalized.rules[0].levels, existingProfile.levels);
  assert.deepEqual(normalized.rules[0].buyLevels, existingProfile.levels);
  assert.deepEqual(normalized.rules[0].sellLevels, existingProfile.levels);
});

test("缺少個別門檻的新深度規則沿用插件新預設", () => {
  const candidate = depthRule("new-default");
  delete candidate.levels;
  delete candidate.buyLevels;
  delete candidate.sellLevels;
  const normalized = normalizeRule(candidate);
  assert.deepEqual(normalized.levels, { level1: 0.1, level2: 0.2, level3: 0.4 });
  assert.deepEqual(normalized.buyLevels, normalized.levels);
  assert.deepEqual(normalized.sellLevels, normalized.levels);
});

test("schema v1 升級會清除規則但保留偏好與釘選頁面", () => {
  const normalized = normalizeSettingsBackup({
    schemaVersion: 1,
    revision: 9,
    updatedAt: 50,
    rules: [{ id: "old-rule" }],
    preferences: { paused: true, notificationsEnabled: true, onboarding: { pinned: true, soundChecked: true } },
    pinnedPage: { url: "https://www.coinglass.com/tv/zh-TW/layout/s6", title: "s6" },
  }, 100);
  assert.equal(normalized.schemaVersion, 2);
  assert.deepEqual(normalized.rules, []);
  assert.equal(normalized.preferences.paused, true);
  assert.equal(normalized.preferences.notificationsEnabled, true);
  assert.equal(normalized.pinnedPage.title, "s6");
  assert.equal(normalized.depthProfile.updatedAt, 0);
});

test("深度規則驗證三段門檻與常用深度標籤", () => {
  assert.equal(normalizeRule(depthRule()).depthLabel, 10);
  assert.throws(() => normalizeRule(depthRule("bad", "BTC", 4)), /深度標籤/);
  assert.throws(() => normalizeRule({
    ...depthRule("bad-levels"),
    custom: true,
    levels: { level1: 0.4, level2: 0.2, level3: 0.55 },
  }), /第一段.*第二段.*第三段/);
});

test("一般規則每條只接受一個高低或穿越條件", () => {
  const rule = normalizeRule({
    id: "generic",
    mode: "generic",
    enabled: true,
    targetKey: "rsi-target",
    unit: "number",
    condition: { kind: "cross-down", threshold: 70 },
    soundEnabled: true,
    targetMeta: { ...targetMeta(), indicator: "RSI" },
  });
  assert.deepEqual(rule.condition, { kind: "cross-down", threshold: 70 });
  assert.throws(() => normalizeRule({ ...rule, condition: { kind: "inside", threshold: 50 } }), /一般提醒條件/);
});

test("同商品不可保存重複深度標籤", () => {
  const existing = [normalizeRule(depthRule("btc-10"))];
  assert.equal(depthLabelConflict(existing, depthRule("btc-copy")), true);
  assert.equal(depthLabelConflict(existing, depthRule("eth-10", "ETH")), false);
  assert.equal(depthLabelConflict(existing, depthRule("btc-3", "BTC", 3)), false);
});

test("v2 備份包含共用門檻且不包含提醒歷史", () => {
  const state = createDefaultState(100);
  state.history = [{ id: "event", time: 100 }];
  const backup = exportSettingsBackup(state, 200);
  assert.equal(backup.schemaVersion, 2);
  assert.equal(backup.depthProfile.updatedAt, 100);
  assert.equal("history" in backup, false);
});

test("內建規則版本與待配對規則會隨設定備份保存", () => {
  const normalized = normalizeSettingsBackup({
    schemaVersion: 2,
    revision: 2,
    updatedAt: 100,
    rules: [],
    preferences: { builtInDefaultsVersion: 1 },
    pinnedPage: null,
    depthProfile: createDefaultState(100).depthProfile,
    pendingRuleTemplates: [{ templateId: "preset-1", target: { symbol: "BTC" }, rule: { mode: "depth-ratio" } }],
  }, 200);
  assert.equal(normalized.preferences.builtInDefaultsVersion, 1);
  assert.equal(normalized.pendingRuleTemplates.length, 1);
  assert.equal(normalized.pendingRuleTemplates[0].templateId, "preset-1");
});
