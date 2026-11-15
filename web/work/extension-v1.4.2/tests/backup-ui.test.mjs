import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiHtml = await readFile(new URL("../src/ui/index.html", import.meta.url), "utf8");
const uiScript = await readFile(new URL("../src/ui/app.js", import.meta.url), "utf8");
const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");

test("插件介面不提供 JSON 下載或檔案匯入", () => {
  assert.doesNotMatch(uiHtml, /export-settings|import-settings|下載 JSON|匯入 JSON/);
  assert.doesNotMatch(uiScript, /downloadBackup|import-settings|export-settings|FileReader|\.files/);
});

test("插件只接受網站橋接恢復，不接收網站備份候選或 UI 匯入命令", () => {
  assert.match(background, /message\.type === "restore-settings"/);
  assert.doesNotMatch(background, /message\.type === "apply-default-rule-template"/);
  assert.match(background, /ensureBuiltInDefaults/);
  assert.match(uiScript, /等待配對/);
  assert.doesNotMatch(background, /backup-candidate|backupCandidates|import-settings|newestBackup/);
});
