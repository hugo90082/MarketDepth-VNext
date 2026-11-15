import assert from "node:assert/strict";
import test from "node:test";

import { dispatchAlertChannels } from "../src/lib/alert-dispatch.js";

test("聲音失敗不會阻止系統通知", async () => {
  const calls = [];
  const result = await dispatchAlertChannels({
    events: [{ sound: "buy2", notificationEnabled: true }],
    notificationsEnabled: true,
    playAudio: async () => { calls.push("audio"); throw new Error("播放失敗"); },
    sendNotification: async () => { calls.push("notification"); },
  });

  assert.deepEqual(calls, ["audio", "notification"]);
  assert.match(result.audioError.message, /播放失敗/);
});

test("系統通知關閉時仍播放規則聲音", async () => {
  const calls = [];
  await dispatchAlertChannels({
    events: [{ sound: "direction-buy", notificationEnabled: true }],
    notificationsEnabled: false,
    playAudio: async () => { calls.push("audio"); },
    sendNotification: async () => { calls.push("notification"); },
  });
  assert.deepEqual(calls, ["audio"]);
});

test("同輪多事件逐筆發送通知但聲音只合併播放一次", async () => {
  const audioCalls = [];
  const notificationCalls = [];
  const events = [
    { id: "buy2", sound: "buy2", notificationEnabled: true },
    { id: "buy3", sound: "buy3", notificationEnabled: true },
  ];
  await dispatchAlertChannels({
    events,
    notificationsEnabled: true,
    playAudio: async (sounds) => { audioCalls.push(sounds); },
    sendNotification: async (event) => { notificationCalls.push(event.id); },
  });

  assert.deepEqual(audioCalls, [["buy2", "buy3"]]);
  assert.deepEqual(notificationCalls, ["buy2", "buy3"]);
});
