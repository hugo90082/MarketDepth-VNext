import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function assertOffscreenModuleEntry(directory) {
  const html = await readFile(path.join(root, directory, "offscreen.html"), "utf8");
  const source = await readFile(path.join(root, directory, "offscreen.js"), "utf8");
  const scriptTag = html.match(/<script\b[^>]*\bsrc=["']offscreen\.js["'][^>]*><\/script>/i)?.[0];

  assert.match(source, /^\s*import\s/m, `${directory}/offscreen.js 應維持 ES module 入口`);
  assert.ok(scriptTag, `${directory}/offscreen.html 應載入 offscreen.js`);
  assert.match(scriptTag, /\btype=["']module["']/i, `${directory}/offscreen.js 含有 import，必須以 type="module" 載入`);
  assert.match(source, /chrome\.runtime\.onMessage\.addListener/, `${directory}/offscreen.js 必須註冊訊息接收器`);
  assert.match(source, /message\?\.type === ["']audio-ping["']/, `${directory}/offscreen.js 必須保留 audio-ping 就緒握手`);
  assert.match(source, /scheduledAt/, `${directory}/offscreen.js 必須保留播放確認時間`);
}

test("來源離線音訊頁以 ES module 載入並保留播放協定", async () => {
  await assertOffscreenModuleEntry("src");
});

test("建置後離線音訊頁以 ES module 載入並保留播放協定", async () => {
  await assertOffscreenModuleEntry("dist");
});
