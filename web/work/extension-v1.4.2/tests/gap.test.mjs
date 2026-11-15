import test from "node:test";
import assert from "node:assert/strict";
import { advanceGapState, intervalToMs } from "../src/lib/gap.js";

test("週期文字轉為毫秒", () => {
  assert.equal(intervalToMs("1"), 60_000);
  assert.equal(intervalToMs("60"), 3_600_000);
  assert.equal(intervalToMs("1D"), 86_400_000);
});

test("只有心跳持續且缺口被有效樣本包夾才判定", () => {
  let state = advanceGapState(undefined, { now: 5_000, valid: true, intervalMs: 60_000, heartbeatGapMs: 10_000 });
  state = advanceGapState(state, { now: 65_000, valid: false, intervalMs: 60_000, heartbeatGapMs: 10_000 });
  state = advanceGapState(state, { now: 125_000, valid: true, intervalMs: 60_000, heartbeatGapMs: 10_000 });
  assert.equal(state.gapDetected, true);
});

test("電腦休眠造成的長心跳中斷不誤判缺 K", () => {
  let state = advanceGapState(undefined, { now: 5_000, valid: true, intervalMs: 60_000, heartbeatGapMs: 10_000 });
  state = advanceGapState(state, { now: 605_000, valid: true, intervalMs: 60_000, heartbeatGapMs: 600_000 });
  assert.equal(state.gapDetected, false);
});
