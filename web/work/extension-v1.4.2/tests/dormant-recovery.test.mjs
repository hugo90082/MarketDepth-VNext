import assert from "node:assert/strict";
import test from "node:test";

import {
  DORMANT_RELOAD_INTERVAL_MS,
  prepareDormantReload,
  shouldReloadDormant,
} from "../src/lib/dormant-recovery.js";

test("休眠第一次立即重載，其後每 120 秒持續重載", () => {
  assert.equal(DORMANT_RELOAD_INTERVAL_MS, 120_000);
  assert.equal(shouldReloadDormant({ dormantRuleIds: ["sleep"], now: 1_000, lastReloadAt: 0 }), true);
  assert.equal(shouldReloadDormant({ dormantRuleIds: ["sleep"], now: 120_999, lastReloadAt: 1_000 }), false);
  assert.equal(shouldReloadDormant({ dormantRuleIds: ["sleep"], now: 121_000, lastReloadAt: 1_000 }), true);
  assert.equal(shouldReloadDormant({ dormantRuleIds: [], now: 999_999, lastReloadAt: 1_000 }), false);
  assert.equal(shouldReloadDormant({ dormantRuleIds: ["sleep"], now: 999_999, lastReloadAt: 1_000, paused: true }), false);
  assert.equal(shouldReloadDormant({ dormantRuleIds: ["sleep"], now: 999_999, lastReloadAt: 1_000, hasPinnedTab: false }), false);
});

test("休眠重載只清除休眠規則狀態並保留正常規則", () => {
  const states = {
    healthy: { policy: { stableSign: 1 }, lastSampleAt: 10 },
    dormant: { policy: { stableSign: -1 }, lastSampleAt: 10 },
  };
  assert.deepEqual(prepareDormantReload(states, ["dormant"]), {
    healthy: states.healthy,
  });
});
