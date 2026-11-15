import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILT_IN_DEFAULTS_VERSION,
  BUILT_IN_DEFAULT_RULES,
  ensureBuiltInDefaults,
} from "../src/lib/built-in-defaults.js";

test("全新或升級後的空規則插件只植入一次六組內建待配對規則", () => {
  const first = ensureBuiltInDefaults({
    rules: [],
    pendingRuleTemplates: [],
    preferences: {},
  });

  assert.equal(first.changed, true);
  assert.equal(first.state.rules.length, 0);
  assert.equal(first.state.pendingRuleTemplates.length, 6);
  assert.equal(first.state.preferences.builtInDefaultsVersion, BUILT_IN_DEFAULTS_VERSION);
  assert.deepEqual(
    first.state.pendingRuleTemplates.map((entry) => `${entry.target.symbol}:${entry.rule.depthLabel}`).sort(),
    ["BTC:10", "BTC:3", "ETH:10", "ETH:3", "SOL:10", "SOL:3"],
  );

  const afterDeletion = ensureBuiltInDefaults({
    ...first.state,
    rules: [],
    pendingRuleTemplates: [],
  });
  assert.equal(afterDeletion.changed, false);
  assert.equal(afterDeletion.state.pendingRuleTemplates.length, 0);
});

test("已有規則的升級使用者只記錄版本，不新增或覆寫規則", () => {
  const existing = { id: "existing-rule" };
  const result = ensureBuiltInDefaults({
    rules: [existing],
    pendingRuleTemplates: [],
    preferences: {},
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.state.rules, [existing]);
  assert.equal(result.state.pendingRuleTemplates.length, 0);
  assert.equal(result.state.preferences.builtInDefaultsVersion, BUILT_IN_DEFAULTS_VERSION);
});

test("六組內建門檻與買賣分離設定符合發布規格", () => {
  assert.equal(BUILT_IN_DEFAULT_RULES.length, 6);
  const byKey = new Map(BUILT_IN_DEFAULT_RULES.map((entry) => [`${entry.target.symbol}:${entry.rule.depthLabel}`, entry.rule]));
  assert.deepEqual(byKey.get("BTC:3")?.buyLevels, { level1: 0.1, level2: 0.2, level3: 0.3 });
  assert.deepEqual(byKey.get("BTC:3")?.sellLevels, { level1: 0.1, level2: 0.2, level3: 0.3 });
  assert.deepEqual(byKey.get("SOL:3")?.buyLevels, { level1: 0.2, level2: 0.4, level3: 0.5 });
  assert.deepEqual(byKey.get("SOL:10")?.sellLevels, { level1: 0.001, level2: 0.1, level3: 0.2 });
  assert.deepEqual(byKey.get("ETH:10")?.buyLevels, { level1: 0.4, level2: 0.55, level3: 0.6 });
  assert.deepEqual(byKey.get("BTC:10")?.sellLevels, { level1: 0.1, level2: 0.2, level3: 0.4 });
  assert.equal(BUILT_IN_DEFAULT_RULES.every((entry) => entry.rule.enabled && entry.rule.soundEnabled && entry.rule.notificationEnabled), true);
});
