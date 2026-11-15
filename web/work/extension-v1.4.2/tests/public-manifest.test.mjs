import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPublicManifest } from "../src/lib/public-manifest.js";

test("公開版只保留 CoinGlass 與 DepthWatch 正式站權限", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const publicManifest = createPublicManifest(manifest);

  assert.deepEqual(publicManifest.host_permissions, [
    "https://www.coinglass.com/tv/zh-TW/*",
    "https://aggregate-spot-depth-test.magic-knoll-8651.chatgpt.site/*",
    "https://order-book-depth-ratio-monitor.magic-knoll-8651.chatgpt.site/*",
    "https://marketdepth-observatory.magic-knoll-8651.chatgpt.site/*",
  ]);
  const bridge = publicManifest.content_scripts.find((script) => script.js.includes("depthwatch-content.js"));
  assert.deepEqual(bridge.matches, [
    "https://aggregate-spot-depth-test.magic-knoll-8651.chatgpt.site/*",
    "https://order-book-depth-ratio-monitor.magic-knoll-8651.chatgpt.site/*",
    "https://marketdepth-observatory.magic-knoll-8651.chatgpt.site/*",
  ]);
  assert.equal(JSON.stringify(publicManifest).includes("localhost"), false);
  assert.equal(JSON.stringify(publicManifest).includes("aggregate-spot-depth.magic-knoll-8651.chatgpt.site"), false);
});
