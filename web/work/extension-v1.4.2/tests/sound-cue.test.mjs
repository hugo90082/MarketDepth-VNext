import assert from "node:assert/strict";
import test from "node:test";
import { buildSoundCue } from "../src/lib/sound-cue.js";

test("深度事件只播放翻轉與最高段音階", () => {
  assert.deepEqual(buildSoundCue(["direction-buy", "buy2", "buy3"]), [
    { start: 330, end: 988, durationMs: 700 },
    { start: 740, durationMs: 160 },
    { start: 988, durationMs: 160 },
    { start: 1319, durationMs: 160 },
  ]);
});

test("一般條件依方向播放升高或降低音", () => {
  assert.deepEqual(buildSoundCue(["cross-up"]), [
    { start: 660, durationMs: 160 },
    { start: 880, durationMs: 160 },
  ]);
  assert.deepEqual(buildSoundCue(["below"]), [
    { start: 550, durationMs: 160 },
    { start: 330, durationMs: 160 },
  ]);
});
