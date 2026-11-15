import assert from "node:assert/strict";
import test from "node:test";
import { buildAlertRecord } from "../src/lib/alert-event.js";

const depthTarget = {
  symbol: "BTC",
  exchange: "Binance",
  interval: "1",
  indicator: "聚合現貨訂單薄深度比值",
  output: "Ratio",
  displayLabel: "BTC｜聚合現貨訂單薄深度比值｜第 1 項",
};

test("深度提醒隱藏長指標名並顯示深度、段位及三位比值", () => {
  const record = buildAlertRecord({
    ruleId: "r1", mode: "depth-ratio", kind: "buy2", depthLabel: 10,
    value: 0.4234, displayValue: "0.4234", time: 100, sound: "buy2",
  }, depthTarget, "event-1");
  assert.equal(record.ruleName, "BTC｜10%｜買 II｜+0.423");
  assert.equal(record.message, "買盤達到第 2 段｜+0.423");
  assert.equal(record.tone, "buy2");
  assert.equal(record.indicator, depthTarget.indicator);
  assert.equal(record.depthLabel, 10);
  assert.equal(record.indicatorLabel, "10%");
});

test("方向翻轉使用精簡名稱與方向 tone", () => {
  const record = buildAlertRecord({
    ruleId: "r1", mode: "depth-ratio", kind: "direction-sell", depthLabel: 3,
    value: -0.0522, displayValue: "-0.0522", time: 100, sound: "direction-sell",
  }, depthTarget, "event-2");
  assert.equal(record.ruleName, "BTC｜3%｜正轉負｜-0.052");
  assert.equal(record.message, "由正轉負｜-0.052");
  assert.equal(record.tone, "direction-sell");
});

test("一般指標保留指標名稱並依條件標示正負 tone", () => {
  const target = { ...depthTarget, indicator: "RSI", displayLabel: "BTC｜RSI（14）" };
  const up = buildAlertRecord({
    ruleId: "r2", mode: "generic", kind: "cross-up", value: 70,
    displayValue: "70", time: 100, sound: "cross-up",
  }, target, "event-3");
  assert.equal(up.ruleName, "BTC｜RSI（14）｜上穿｜70");
  assert.equal(up.tone, "generic-up");
  assert.equal(up.indicatorLabel, "RSI（14）");
});
