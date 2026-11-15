import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyDepthPolicyState,
  evaluateDepthPolicy,
} from "../src/lib/depth-policy.js";

const levels = { buy: [0.2, 0.4, 0.55], sell: [0.2, 0.4, 0.55] };

test("第一段持續六十秒才提醒且不週期重複", () => {
  let result = evaluateDepthPolicy(0.25, levels, 1_000, emptyDepthPolicyState());
  assert.deepEqual(result.events, []);
  result = evaluateDepthPolicy(0.25, levels, 60_999, result.state);
  assert.deepEqual(result.events, []);
  result = evaluateDepthPolicy(0.25, levels, 61_000, result.state);
  assert.deepEqual(result.events, ["buy1"]);
  result = evaluateDepthPolicy(0.25, levels, 121_000, result.state);
  assert.deepEqual(result.events, []);
});

test("第一段離開後重新武裝並重新計算六十秒", () => {
  let result = evaluateDepthPolicy(0.25, levels, 1_000, emptyDepthPolicyState());
  result = evaluateDepthPolicy(0.25, levels, 61_000, result.state);
  assert.deepEqual(result.events, ["buy1"]);
  result = evaluateDepthPolicy(0.1, levels, 62_000, result.state);
  assert.deepEqual(result.events, []);
  result = evaluateDepthPolicy(0.25, levels, 63_000, result.state);
  result = evaluateDepthPolicy(0.25, levels, 122_999, result.state);
  assert.deepEqual(result.events, []);
  result = evaluateDepthPolicy(0.25, levels, 123_000, result.state);
  assert.deepEqual(result.events, ["buy1"]);
});

test("直接跳第三段立即記錄第二與第三段並只重複最高段", () => {
  let result = evaluateDepthPolicy(0.6, levels, 1_000, emptyDepthPolicyState());
  assert.deepEqual(result.events, ["buy2", "buy3"]);
  result = evaluateDepthPolicy(0.6, levels, 61_000, result.state);
  assert.deepEqual(result.events, ["buy3"]);
});

test("方向翻轉使用正負 0.01 緩衝並先於門檻事件", () => {
  let result = evaluateDepthPolicy(-0.3, levels, 1_000, emptyDepthPolicyState());
  result = evaluateDepthPolicy(0.005, levels, 2_000, result.state);
  assert.deepEqual(result.events, []);
  result = evaluateDepthPolicy(0.45, levels, 3_000, result.state);
  assert.deepEqual(result.events, ["direction-buy", "buy2"]);
});

test("買賣兩側可使用不同三段門檻", () => {
  const asymmetric = { buy: [0.1, 0.3, 0.5], sell: [0.25, 0.45, 0.65] };
  assert.deepEqual(evaluateDepthPolicy(0.35, asymmetric, 1_000).events, ["buy2"]);
  assert.deepEqual(evaluateDepthPolicy(-0.35, asymmetric, 1_000).events, []);
});
