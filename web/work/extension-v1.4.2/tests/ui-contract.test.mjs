import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { openSidePanel } from "../src/ui/side-panel.js";
import { validateGenericDraft, validateLevelDraft } from "../src/ui/rule-draft.js";

test("側邊欄由 UI 直接使用已知視窗 ID 開啟", async () => {
  const calls = [];
  await openSidePanel({ sidePanel: { open: (options) => { calls.push(options); return Promise.resolve(); } } }, 42);
  assert.deepEqual(calls, [{ windowId: 42 }]);
});

test("介面提供深度三段專用模式及一般單一條件模式", async () => {
  const html = await readFile(new URL("../src/ui/index.html", import.meta.url), "utf8");
  assert.match(html, /id="depth-editor"/);
  assert.match(html, /id="depth-label"/);
  assert.match(html, /id="split-sides"/);
  assert.match(html, /id="generic-editor"/);
  assert.match(html, /value="cross-up"/);
  assert.match(html, /value="cross-down"/);
  assert.doesNotMatch(html, /自訂名稱|重複週期/);
});

test("插件移除全域門檻卡，深度規則直接編輯自身三段門檻", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../src/ui/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/app.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(html, /global-levels|global-level-[123]|custom-levels|獨立覆寫全域門檻/);
  assert.match(html, /id="shared-level-1"/);
  assert.match(html, /id="shared-level-2"/);
  assert.match(html, /id="shared-level-3"/);
  assert.doesNotMatch(app, /renderGlobalLevels|set-depth-profile|saveGlobal|customLevels/);
});

test("聲音試聽顯示可觀測的播放狀態", async () => {
  const html = await readFile(new URL("../src/ui/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  assert.match(html, /id="audio-status"/);
  assert.match(app, /audioHealth/);
  assert.match(app, /聲音正常/);
  assert.match(app, /播放失敗/);
});

test("離線音訊頁提供就緒與播放確認", async () => {
  const source = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  assert.match(source, /audio-ping/);
  assert.match(source, /contextState/);
  assert.match(source, /scheduledAt/);
});

test("一般門檻與三段門檻草稿採集中驗證", () => {
  assert.deepEqual(validateGenericDraft({ kind: "cross-up", thresholdRaw: "0.2", unit: "number" }), { kind: "cross-up", threshold: 0.2 });
  assert.throws(() => validateGenericDraft({ kind: "above", thresholdRaw: "", unit: "number" }), /請輸入門檻/);
  assert.deepEqual(validateLevelDraft({ level1: 0.2, level2: 0.4, level3: 0.55 }), { level1: 0.2, level2: 0.4, level3: 0.55 });
  assert.throws(() => validateLevelDraft({ level1: 0.4, level2: 0.2, level3: 0.55 }), /第一段.*第二段.*第三段/);
});

test("UI 不透過背景命令開啟側邊欄且使用狀態色", async () => {
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  const style = await readFile(new URL("../src/ui/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(app, /send\("open-side-panel"\)/);
  assert.match(app, /openSidePanel/);
  assert.match(style, /tone-buy3/);
  assert.match(style, /tone-sell3/);
  assert.match(style, /tone-direction-buy/);
});

test("提醒紀錄位於第二張卡片並使用固定高度單行列表", async () => {
  const html = await readFile(new URL("../src/ui/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
  const style = await readFile(new URL("../src/ui/style.css", import.meta.url), "utf8");
  const statusAt = html.indexOf("status-card");
  const historyAt = html.indexOf("id=\"history-list\"");
  const editorAt = html.indexOf("rule-editor");
  assert.ok(statusAt >= 0 && historyAt > statusAt && editorAt > historyAt);
  assert.doesNotMatch(app, /<details|<summary/);
  assert.match(style, /body\[data-mode="popup"\][\s\S]*\.history[^}]*max-height:\s*280px/);
  assert.match(style, /body\[data-mode="side"\][\s\S]*\.history[^}]*max-height:\s*340px/);
  assert.match(style, /white-space:\s*nowrap/);
  assert.match(style, /text-overflow:\s*ellipsis/);
});
