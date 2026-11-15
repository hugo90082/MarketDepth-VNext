import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPTH_LABELS,
  classifyIndicatorTarget,
  normalizeDepthLabel,
} from "../src/lib/indicator-mode.js";

test("辨識訂單簿與訂單薄兩種聚合現貨深度比值名稱", () => {
  for (const indicator of [
    "聚合現貨訂單簿深度比值",
    "✦ 聚合現貨訂單薄深度比值 Aggregated Spot Order Book Depth Ratio ✦",
  ]) {
    assert.equal(classifyIndicatorTarget({ indicator }), "depth-ratio");
  }
  assert.equal(classifyIndicatorTarget({ indicator: "RSI" }), "generic");
});

test("深度標籤只接受八個常用值", () => {
  assert.deepEqual(DEPTH_LABELS, [0.25, 0.5, 0.75, 1, 2, 3, 5, 10]);
  assert.equal(normalizeDepthLabel("3"), 3);
  assert.equal(normalizeDepthLabel(0.75), 0.75);
  assert.equal(normalizeDepthLabel(4), null);
});
