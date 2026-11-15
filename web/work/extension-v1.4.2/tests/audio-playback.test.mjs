import assert from "node:assert/strict";
import test from "node:test";

import { createAudioPlaybackController } from "../src/lib/audio-playback.js";

function createChromeMock({ pingResponses = [], playResponses = [] } = {}) {
  const calls = [];
  let hasDocument = false;
  return {
    calls,
    api: {
      offscreen: {
        async hasDocument() { return hasDocument; },
        async createDocument() { calls.push("create"); hasDocument = true; },
        async closeDocument() { calls.push("close"); hasDocument = false; },
      },
      runtime: {
        async sendMessage(message) {
          calls.push(message.type);
          if (message.type === "audio-ping") {
            const response = pingResponses.shift();
            if (response instanceof Error) throw response;
            return response ?? { ok: true, contextState: "none" };
          }
          if (message.type === "play-sound") {
            const response = playResponses.shift();
            if (response instanceof Error) throw response;
            return response ?? { ok: true, contextState: "running", scheduledAt: 100 };
          }
          throw new Error(`unexpected message ${message.type}`);
        },
      },
    },
  };
}

test("音訊頁建立後等待 listener 就緒才播放", async () => {
  const chrome = createChromeMock({
    pingResponses: [new Error("Receiving end does not exist"), { ok: true, contextState: "none" }],
  });
  const controller = createAudioPlaybackController({
    chromeApi: chrome.api,
    wait: async () => undefined,
    readyTimeoutMs: 100,
    readyPollMs: 1,
  });

  const result = await controller.play(["buy3"]);

  assert.equal(result.ok, true);
  assert.equal(result.contextState, "running");
  assert.deepEqual(chrome.calls, ["create", "audio-ping", "audio-ping", "play-sound"]);
});

test("首次播放失敗會重建音訊頁並只重試一次", async () => {
  const chrome = createChromeMock({
    playResponses: [
      { ok: false, contextState: "suspended", error: "AudioContext 無法啟動" },
      { ok: true, contextState: "running", scheduledAt: 200 },
    ],
  });
  const controller = createAudioPlaybackController({ chromeApi: chrome.api, wait: async () => undefined });

  const result = await controller.play(["direction-buy"]);

  assert.equal(result.ok, true);
  assert.equal(chrome.calls.filter((call) => call === "play-sound").length, 2);
  assert.equal(chrome.calls.filter((call) => call === "close").length, 1);
  assert.equal(chrome.calls.filter((call) => call === "create").length, 2);
});

test("第二次仍失敗時回報實際原因，後續播放仍可再嘗試", async () => {
  const chrome = createChromeMock({
    playResponses: [new Error("message channel closed"), { ok: false, contextState: "suspended", error: "仍無法播放" }, { ok: true, contextState: "running", scheduledAt: 300 }],
  });
  const controller = createAudioPlaybackController({ chromeApi: chrome.api, wait: async () => undefined });

  await assert.rejects(controller.play(["sell2"]), /仍無法播放/);
  const recovered = await controller.play(["buy1"]);
  assert.equal(recovered.ok, true);
});

test("併發播放會序列化，不建立重疊的音訊工作", async () => {
  let releaseFirst;
  let active = 0;
  let maxActive = 0;
  const chrome = createChromeMock();
  chrome.api.runtime.sendMessage = async (message) => {
    chrome.calls.push(message.type);
    if (message.type === "audio-ping") return { ok: true, contextState: "none" };
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (!releaseFirst) await new Promise((resolve) => { releaseFirst = resolve; });
    active -= 1;
    return { ok: true, contextState: "running", scheduledAt: Date.now() };
  };
  const controller = createAudioPlaybackController({ chromeApi: chrome.api, wait: async () => undefined });

  const first = controller.play(["buy1"]);
  const second = controller.play(["sell1"]);
  for (let attempt = 0; attempt < 10 && !releaseFirst; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(typeof releaseFirst, "function");
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(maxActive, 1);
});
