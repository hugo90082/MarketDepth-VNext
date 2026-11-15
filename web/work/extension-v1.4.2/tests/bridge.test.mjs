import test from "node:test";
import assert from "node:assert/strict";
import {
  bridgeAllowsCommand,
  buildWebsiteSnapshotPayload,
  mergeAlertHistory,
  readBridgeCapabilities,
  validateEnvelope,
} from "../src/lib/bridge.js";

test("橋接只接受版本正確的有限訊息", () => {
  assert.equal(validateEnvelope({ protocolVersion: 2, type: "hello", revision: 0, payload: {} }), true);
  assert.equal(validateEnvelope({ protocolVersion: 1, type: "hello", revision: 0, payload: {} }), false);
  assert.equal(validateEnvelope({ protocolVersion: 2, type: "x".repeat(100), revision: 0, payload: {} }), false);
});

test("補回最近紀錄時依 source 與 id 去重", () => {
  const current = [{ source: "depthwatch", id: "1", time: 1 }, { source: "coinglass-indicator-extension", id: "a", time: 2 }];
  const incoming = [{ source: "coinglass-indicator-extension", id: "a", time: 2 }, { source: "coinglass-indicator-extension", id: "b", time: 3 }];
  assert.deepEqual(mergeAlertHistory(current, incoming, 200).map((item) => item.id), ["1", "a", "b"]);
});

test("網站可用版本化信封要求插件恢復設定", () => {
  assert.equal(validateEnvelope({
    protocolVersion: 2,
    type: "restore-settings",
    revision: 4,
    payload: { schemaVersion: 2, revision: 4 },
  }), true);
});

test("新版網站取得完整備份但網站門檻更新命令被拒絕", () => {
  const capabilities = readBridgeCapabilities({ capabilities: { independentThresholds: true, portableRuleTemplates: true } });
  assert.deepEqual(capabilities, { independentThresholds: true });
  const status = {
    extensionVersion: "1.3.0",
    history: [],
    settingsBackup: { schemaVersion: 2, rules: [{ id: "depth" }] },
    depthProfile: { levels: { level1: 0.1, level2: 0.2, level3: 0.4 }, revision: 1, updatedAt: 100, source: "extension" },
    health: { status: "ok", dormantCount: 0 },
  };
  const payload = buildWebsiteSnapshotPayload(status, capabilities, 200);
  assert.equal(payload.settingsBackup, status.settingsBackup);
  assert.deepEqual(payload.depthProfile.levels, { level1: 0.1, level2: 0.2, level3: 0.4 });
  assert.deepEqual(payload.capabilities, { independentThresholds: true });
  assert.equal("defaultTemplate" in payload, false);
  assert.equal(bridgeAllowsCommand("update-depth-profile"), false);
  assert.equal(bridgeAllowsCommand("restore-settings"), true);
});

test("網站橋接不再接受套用預設規則指令", () => {
  assert.equal(bridgeAllowsCommand("apply-default-rule-template"), false);
});

test("舊網站只取得歷史與網站安全門檻，不會收到可匯入規則", () => {
  const capabilities = readBridgeCapabilities({});
  const status = {
    extensionVersion: "1.3.0",
    history: [{ id: "alert" }],
    settingsBackup: { schemaVersion: 2, rules: [{ id: "depth" }] },
    depthProfile: { levels: { level1: 0.1, level2: 0.2, level3: 0.4 }, revision: 1, updatedAt: 100, source: "extension" },
    health: { status: "ok", dormantCount: 0 },
  };
  const payload = buildWebsiteSnapshotPayload(status, capabilities, 200);
  assert.equal(payload.settingsBackup, null);
  assert.deepEqual(payload.history, status.history);
  assert.deepEqual(payload.depthProfile.levels, { level1: 0.2, level2: 0.3, level3: 0.4 });
  assert.equal(payload.depthProfile.updatedAt, 200);
});
