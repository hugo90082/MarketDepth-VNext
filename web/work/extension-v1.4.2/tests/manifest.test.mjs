import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("MV3 權限只涵蓋 CoinGlass TV 與指定 DepthWatch 網址", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "1.4.1");
  assert.equal(manifest.permissions.includes("cookies"), false);
  assert.equal(manifest.permissions.includes("webRequest"), false);
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  assert.ok(manifest.host_permissions.includes("https://marketdepth-observatory.magic-knoll-8651.chatgpt.site/*"));
  assert.ok(manifest.content_scripts.find(s => s.js.includes("depthwatch-content.js")).matches.includes("https://marketdepth-observatory.magic-knoll-8651.chatgpt.site/*"));
  assert.ok(manifest.host_permissions.includes("https://www.coinglass.com/tv/zh-TW/*"));
  assert.ok(manifest.host_permissions.includes("https://aggregate-spot-depth-test.magic-knoll-8651.chatgpt.site/*"));
  assert.ok(manifest.host_permissions.includes("https://order-book-depth-ratio-monitor.magic-knoll-8651.chatgpt.site/*"));
  assert.equal(manifest.host_permissions.includes("https://aggregate-spot-depth.magic-knoll-8651.chatgpt.site/*"), false);
});

test("插件同時提供工具列彈窗、側邊面板與網站橋接", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.action.default_popup, "ui/index.html?mode=popup");
  assert.equal(manifest.side_panel.default_path, "ui/index.html?mode=side");
  assert.ok(manifest.content_scripts.some((script) => script.js.includes("depthwatch-content.js")));
});
