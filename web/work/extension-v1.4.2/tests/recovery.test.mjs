import assert from "node:assert/strict";
import test from "node:test";
import { advanceRecoveryDecision } from "../src/lib/recovery.js";

test("單次讀取失敗不重載，連續兩次才進入復原", () => {
  const first = advanceRecoveryDecision(undefined, { success: false });
  assert.equal(first.failureStreak, 1);
  assert.equal(first.shouldRecover, false);
  const second = advanceRecoveryDecision(first, { success: false });
  assert.equal(second.failureStreak, 2);
  assert.equal(second.shouldRecover, true);
  assert.equal(advanceRecoveryDecision(second, { success: true }).failureStreak, 0);
});

test("可信週期缺口可立即進入復原", () => {
  assert.equal(advanceRecoveryDecision(undefined, { success: true, trustedGap: true }).shouldRecover, true);
});
