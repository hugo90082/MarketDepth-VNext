import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRules, resetAfterReload } from "../src/lib/rule-engine.js";

const targetKey = "BTC|USDT|Binance|1|1|Ratio||Ratio|0|number";
const sample = (value, capturedAt) => ({
  [targetKey]: { value, displayValue: String(value), capturedAt },
});

const genericRule = (kind, threshold) => ({
  id: `generic-${kind}`,
  mode: "generic",
  enabled: true,
  targetKey,
  unit: "number",
  condition: { kind, threshold },
  soundEnabled: true,
});

const depthRule = (extra = {}) => ({
  id: "depth-10",
  mode: "depth-ratio",
  enabled: true,
  targetKey,
  unit: "number",
  depthLabel: 10,
  custom: false,
  splitSides: false,
  levels: { level1: 0.2, level2: 0.4, level3: 0.55 },
  buyLevels: { level1: 0.2, level2: 0.4, level3: 0.55 },
  sellLevels: { level1: 0.2, level2: 0.4, level3: 0.55 },
  soundEnabled: true,
  notificationEnabled: true,
  ...extra,
});

test("一般上穿先建立基準，再於不同擷取時間真正跨越時提醒一次", () => {
  let result = evaluateRules({ rules: [genericRule("cross-up", 10)], samples: sample(9, 1_000), states: {}, now: 1_000 });
  assert.deepEqual(result.events, []);
  result = evaluateRules({ rules: [genericRule("cross-up", 10)], samples: sample(10, 2_000), states: result.states, now: 2_000 });
  assert.equal(result.events[0].kind, "cross-up");
  result = evaluateRules({ rules: [genericRule("cross-up", 10)], samples: sample(11, 3_000), states: result.states, now: 70_000 });
  assert.deepEqual(result.events, []);
});

test("一般高於條件立即提醒並於六十秒後重複", () => {
  let result = evaluateRules({ rules: [genericRule("above", 10)], samples: sample(10, 1_000), states: {}, now: 1_000 });
  assert.equal(result.events[0].reason, "entered");
  result = evaluateRules({ rules: [genericRule("above", 10)], samples: sample(11, 61_000), states: result.states, now: 61_000 });
  assert.equal(result.events[0].reason, "repeat");
});

test("深度規則使用全域三段並輸出 DepthWatch 事件與深度標籤", () => {
  const result = evaluateRules({
    rules: [depthRule()],
    samples: sample(0.6, 1_000),
    states: {},
    now: 1_000,
    globalLevels: { level1: 0.2, level2: 0.4, level3: 0.55 },
  });
  assert.deepEqual(result.events.map((event) => event.kind), ["buy2", "buy3"]);
  assert.equal(result.events[0].depthLabel, 10);
  assert.equal(result.events[0].sound, "buy2");
  assert.equal(result.events[0].notificationEnabled, true);
});

test("缺少有效樣本會重設規則狀態且重新載入會清除穿越基準", () => {
  let result = evaluateRules({ rules: [genericRule("cross-down", 10)], samples: sample(11, 1_000), states: {}, now: 1_000 });
  result = evaluateRules({ rules: [genericRule("cross-down", 10)], samples: {}, states: result.states, now: 2_000 });
  assert.equal(result.states["generic-cross-down"], undefined);
  assert.deepEqual(resetAfterReload({ stale: { previousValue: 10 } }), {});
});
