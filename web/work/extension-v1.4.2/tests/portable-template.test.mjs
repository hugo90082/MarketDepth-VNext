import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPortableRuleTemplate,
  resolvePendingRuleTemplates,
} from "../src/lib/portable-template.js";

const levels = { level1: 0.1, level2: 0.2, level3: 0.4 };
const target = (symbol, overrides = {}) => ({
  key: `${symbol}|USDT|Binance|1|0|聚合現貨訂單薄深度比值||Ratio|0|number`,
  symbol,
  quote: "USDT",
  exchange: "Binance",
  interval: "1",
  paneOrdinal: 0,
  indicator: "聚合現貨訂單薄深度比值",
  params: "",
  output: "Ratio",
  outputIndex: 0,
  unit: "number",
  status: "ok",
  ...overrides,
});

const templateRule = (symbol, depthLabel = 10) => ({
  templateId: `${symbol}-${depthLabel}`,
  target: {
    symbol,
    interval: "1",
    indicator: "聚合現貨訂單薄深度比值",
    params: "",
    output: "Ratio",
    outputIndex: 0,
    unit: "number",
  },
  rule: {
    mode: "depth-ratio",
    enabled: true,
    depthLabel,
    splitSides: false,
    levels,
    buyLevels: levels,
    sellLevels: levels,
    soundEnabled: true,
    notificationEnabled: true,
  },
});

test("首次範本只在無規則且從未套用時可使用", () => {
  const template = { templateVersion: 1, rules: [templateRule("BTC")] };
  const first = applyPortableRuleTemplate({ template, rules: [], pending: [], catalog: [target("BTC")], alreadyApplied: false, idFactory: () => "new-rule" });
  assert.equal(first.applied, true);
  assert.equal(first.matchedCount, 1);
  assert.equal(first.pendingCount, 0);
  assert.equal(first.rules[0].id, "new-rule");
  assert.equal(first.rules[0].custom, true);
  assert.equal(first.alreadyApplied, true);
  assert.throws(() => applyPortableRuleTemplate({ template, rules: first.rules, pending: [], catalog: [target("BTC")], alreadyApplied: true }), /首次使用/);
});

test("無法唯一配對的範本留在待配對且不進入正式規則", () => {
  const template = { templateVersion: 1, rules: [templateRule("ETH"), templateRule("SOL")] };
  const result = applyPortableRuleTemplate({ template, rules: [], pending: [], catalog: [
    target("SOL", { key: "sol-a" }),
    target("SOL", { key: "sol-b" }),
  ], alreadyApplied: false, idFactory: () => "unused" });
  assert.equal(result.rules.length, 0);
  assert.equal(result.pendingCount, 2);
  assert.deepEqual(result.pending.map((item) => item.templateId).sort(), ["ETH-10", "SOL-10"]);
});

test("後續掃描到唯一目標會自動補配並重新產生規則 ID", () => {
  const pending = [templateRule("ETH")];
  const resolved = resolvePendingRuleTemplates({
    pending,
    rules: [],
    catalog: [target("ETH")],
    idFactory: () => "resolved-rule",
  });
  assert.equal(resolved.rules.length, 1);
  assert.equal(resolved.rules[0].id, "resolved-rule");
  assert.equal(resolved.pending.length, 0);
  assert.equal(resolved.matchedCount, 1);
});

test("同名指標以非敏感的窗格序號完成唯一配對", () => {
  const entry = templateRule("BTC");
  entry.target.paneOrdinal = 2;
  const result = applyPortableRuleTemplate({
    template: { templateVersion: 1, rules: [entry] },
    rules: [], pending: [], alreadyApplied: false,
    catalog: [target("BTC", { key: "btc-pane-1", paneOrdinal: 1 }), target("BTC", { key: "btc-pane-2", paneOrdinal: 2 })],
    idFactory: () => "pane-rule",
  });
  assert.equal(result.matchedCount, 1);
  assert.equal(result.rules[0].targetKey, "btc-pane-2");
});
