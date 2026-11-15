import { compatibleTarget, targetBaseLabel } from "../lib/catalog.js";
import { classifyIndicatorTarget } from "../lib/indicator-mode.js";
import { clearDraftFieldError, markDraftFieldError, RuleDraftError, validateGenericDraft, validateLevelDraft } from "./rule-draft.js";
import { openSidePanel } from "./side-panel.js";
import { DEFAULT_LEVELS } from "../lib/settings.js";

const $ = (selector) => document.querySelector(selector);
const uiPort = chrome.runtime.connect({ name: "indicator-ui" });
const uiMode = new URLSearchParams(window.location.search).get("mode") === "side" ? "side" : "popup";
document.body.dataset.mode = uiMode;

let status;
let editingRuleId = null;
let currentWindowId = null;

const elements = {
  healthDot: $("#health-dot"), healthLabel: $("#health-label"), healthDetail: $("#health-detail"),
  pin: $("#pin-page"), scan: $("#scan-now"), pause: $("#toggle-pause"), notifications: $("#toggle-notifications"),
  checkPin: $("#check-pin"), testSound: $("#test-sound"), audioStatus: $("#audio-status"), openSide: $("#open-side"), sideError: $("#side-panel-error"),
  target: $("#target-select"), targetValue: $("#target-value"), depthEditor: $("#depth-editor"), genericEditor: $("#generic-editor"),
  depthLabel: $("#depth-label"), splitSides: $("#split-sides"), sharedPanel: $("#shared-levels"), splitPanel: $("#split-levels"),
  sharedLevels: [$("#shared-level-1"), $("#shared-level-2"), $("#shared-level-3")], buyLevels: [$("#buy-level-1"), $("#buy-level-2"), $("#buy-level-3")], sellLevels: [$("#sell-level-1"), $("#sell-level-2"), $("#sell-level-3")],
  depthSound: $("#depth-sound-enabled"), depthNotification: $("#depth-notification-enabled"),
  genericKind: $("#generic-kind"), genericThreshold: $("#generic-threshold"), genericSound: $("#generic-sound-enabled"),
  compatible: $("#compatible-targets"), error: $("#form-error"), save: $("#save-rule"), cancel: $("#cancel-edit"),
  ruleCount: $("#rule-count"), rules: $("#rules-list"), history: $("#history-list"), clearHistory: $("#clear-history"), editorTitle: $("#editor-title"),
};

if (uiMode === "side") elements.openSide.hidden = true;
else {
  elements.openSide.disabled = true;
  chrome.windows.getCurrent().then((window) => {
    if (!Number.isInteger(window?.id)) throw new Error("無法取得目前視窗");
    currentWindowId = window.id;
    elements.openSide.disabled = false;
  }).catch((error) => showSideError(error instanceof Error ? error.message : "無法取得目前視窗"));
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error ?? "操作失敗");
  return response;
}

function showSideError(message) { elements.sideError.textContent = `側邊欄開啟失敗：${message}`; elements.sideError.hidden = false; }
function displayLabel(target) { return target?.displayLabel || targetBaseLabel(target ?? {}); }
function selectedTarget() { return status?.catalog?.targets?.find((target) => target.key === elements.target.value) ?? null; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function levelsFrom(inputs) { return { level1: inputs[0].value, level2: inputs[1].value, level3: inputs[2].value }; }
function fillLevels(inputs, levels) { inputs.forEach((input, index) => { input.value = String(levels?.[`level${index + 1}`] ?? ""); }); }

function renderStatus() {
  const health = status.health;
  elements.healthDot.className = `dot ${health.status}`;
  const labels = { idle: "尚未監控", loading: "正在掃描", ok: "監控正常", dormant: "部分規則休眠", error: "讀取發生錯誤", fatal: "監控已停止" };
  elements.healthLabel.textContent = labels[health.status] ?? health.status;
  const pendingCount = Math.max(0, Number(status.builtInDefaults?.pendingCount) || 0);
  const detail = health.error || (status.pinnedPage ? "已釘選 CoinGlass TV 頁面" : "請先釘選 CoinGlass 頁面");
  elements.healthDetail.textContent = pendingCount ? `${detail} · 等待配對 ${pendingCount} 條` : detail;
  elements.pause.textContent = status.preferences.paused ? "繼續監控" : "暫停監控";
  const enabled = status.preferences.notificationsEnabled === true;
  elements.notifications.textContent = enabled ? "🔔 通知已開啟" : "🔕 通知已關閉";
  elements.notifications.className = `notification-toggle ${enabled ? "is-on" : "is-off"}`;
  elements.notifications.setAttribute("aria-pressed", String(enabled));
  elements.checkPin.classList.toggle("done", status.preferences.onboarding.pinned);
  const audio = status.audioHealth ?? { status: "idle", error: "", lastPlayedAt: 0 };
  elements.testSound.classList.toggle("done", audio.status === "ready");
  elements.testSound.classList.toggle("audio-error", audio.status === "error");
  if (audio.status === "ready") {
    const time = audio.lastPlayedAt ? new Date(audio.lastPlayedAt).toLocaleTimeString("zh-TW", { hour12: false }) : "";
    elements.audioStatus.textContent = `聲音正常${time ? ` · ${time}` : ""}`;
    elements.audioStatus.className = "audio-status ready";
  } else if (audio.status === "error") {
    elements.audioStatus.textContent = `播放失敗：${audio.error || "請重新試聽"}`;
    elements.audioStatus.className = "audio-status error";
  } else {
    elements.audioStatus.textContent = "尚未完成聲音試聽";
    elements.audioStatus.className = "audio-status";
  }
}

function renderTargets() {
  const current = elements.target.value;
  const targets = status.catalog.targets ?? [];
  elements.target.innerHTML = targets.length
    ? targets.map((target) => `<option value="${escapeHtml(target.key)}">${escapeHtml(displayLabel(target))}${target.status === "hidden" ? "（已隱藏）" : ""}</option>`).join("")
    : '<option value="">尚未掃描到指標數值</option>';
  if (targets.some((target) => target.key === current)) elements.target.value = current;
  renderTargetDetails();
}

function renderTargetDetails() {
  const target = selectedTarget();
  elements.targetValue.textContent = target ? `目前 ${target.displayValue} · ${target.status === "hidden" ? "指標已隱藏" : "可建立提醒"}` : "請先掃描指標數值";
  const mode = target ? classifyIndicatorTarget(target) : "generic";
  elements.depthEditor.hidden = mode !== "depth-ratio";
  elements.genericEditor.hidden = mode !== "generic";
  elements.compatible.hidden = editingRuleId !== null;
  if (editingRuleId) return;
  if (!target) {
    elements.compatible.innerHTML = "<legend>同時套用到其他商品</legend><p>尚無可套用的相容指標。</p>";
    return;
  }
  const compatible = status.catalog.targets.filter((candidate) => candidate.key !== target.key && compatibleTarget(target, candidate));
  elements.compatible.innerHTML = `<legend>同時套用到其他商品</legend>${compatible.length
    ? `<div class="compatible-grid">${compatible.map((candidate) => `<label title="${escapeHtml(displayLabel(candidate))}"><input type="checkbox" value="${escapeHtml(candidate.key)}"><span>${escapeHtml(displayLabel(candidate))}</span></label>`).join("")}</div>`
    : "<p>沒有其他完全相容的商品指標可同時套用。</p>"}`;
}

function updateDepthEditor() {
  const split = elements.splitSides.checked;
  elements.sharedPanel.hidden = split;
  elements.splitPanel.hidden = !split;
}

const genericLabels = { above: "高於或等於", below: "低於或等於", "cross-up": "上穿", "cross-down": "下穿" };
function levelsSummary(levels) { return `${levels.level1}／${levels.level2}／${levels.level3}`; }

function ruleName(rule, meta) {
  if (rule.mode === "depth-ratio") return `${meta.symbol || "?"}｜${rule.depthLabel}%`;
  return displayLabel(meta);
}

function conditionLabel(rule) {
  if (rule.mode === "depth-ratio") {
    if (rule.splitSides) return `賣 ${levelsSummary(rule.sellLevels)}｜買 ${levelsSummary(rule.buyLevels)}`;
    return `三段 ${levelsSummary(rule.levels)}`;
  }
  return `${genericLabels[rule.condition.kind]} ${rule.condition.threshold}${rule.unit === "%" ? "%" : ""}`;
}

function renderRules() {
  elements.ruleCount.textContent = `${status.rules.length} / 200`;
  if (!status.rules.length) { elements.rules.className = "list empty"; elements.rules.textContent = "尚無規則"; return; }
  elements.rules.className = "list";
  elements.rules.innerHTML = status.rules.map((rule) => {
    const target = status.catalog.targets.find((item) => item.key === rule.targetKey);
    const meta = target ?? rule.targetMeta ?? {};
    const liveValue = target?.status === "ok" ? `目前 ${target.displayValue}` : "目前無有效數值";
    const switches = rule.mode === "depth-ratio" ? `${rule.soundEnabled ? "聲音" : "無聲"}｜${rule.notificationEnabled ? "通知" : "無通知"}` : (rule.soundEnabled ? "聲音" : "無聲");
    return `<article class="rule-item ${rule.mode}" data-rule-id="${escapeHtml(rule.id)}">
      <header><strong title="${escapeHtml(ruleName(rule, meta))}">${escapeHtml(ruleName(rule, meta))}</strong><label class="switch"><input class="rule-enabled" type="checkbox" ${rule.enabled ? "checked" : ""}><span>啟用</span></label></header>
      <div class="meta">${escapeHtml(`${conditionLabel(rule)} · ${switches} · ${liveValue}`)}</div>
      <div class="rule-actions"><button data-action="edit" type="button">修改</button><button data-action="delete" class="danger" type="button">刪除</button></div>
    </article>`;
  }).join("");
}

function renderHistory() {
  if (!status.history.length) { elements.history.className = "history empty"; elements.history.textContent = "尚無提醒"; return; }
  elements.history.className = "history";
  elements.history.innerHTML = [...status.history].reverse().map((entry) => {
    const time = formatHistoryTime(entry.time);
    const line = `${time}｜插件｜${entry.ruleName}`;
    return `<article class="history-item tone-${escapeHtml(entry.tone || "neutral")}" title="${escapeHtml(line)}"><time>${escapeHtml(time)}</time><span aria-hidden="true">｜插件｜</span><strong>${escapeHtml(entry.ruleName)}</strong></article>`;
  }).join("");
}

function formatHistoryTime(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function render() { if (!status) return; renderStatus(); renderTargets(); renderRules(); renderHistory(); }

function depthRuleDraft() {
  const splitSides = elements.splitSides.checked;
  const levels = validateLevelDraft(levelsFrom(elements.sharedLevels));
  const buyLevels = splitSides ? validateLevelDraft(levelsFrom(elements.buyLevels), "buyLevels") : levels;
  const sellLevels = splitSides ? validateLevelDraft(levelsFrom(elements.sellLevels), "sellLevels") : levels;
  return { depthLabel: Number(elements.depthLabel.value), custom: true, splitSides, levels, buyLevels, sellLevels, soundEnabled: elements.depthSound.checked, notificationEnabled: elements.depthNotification.checked };
}

async function saveRule() {
  elements.error.textContent = "";
  clearDraftFieldError(elements.genericThreshold);
  const target = selectedTarget();
  if (!target) return void (elements.error.textContent = "請選擇主要指標");
  try {
    const mode = classifyIndicatorTarget(target);
    const draft = mode === "depth-ratio"
      ? depthRuleDraft()
      : { condition: validateGenericDraft({ kind: elements.genericKind.value, thresholdRaw: elements.genericThreshold.value, unit: target.unit }), soundEnabled: elements.genericSound.checked };
    const rule = { ...(editingRuleId ? { id: editingRuleId } : {}), enabled: true, ...draft };
    if (editingRuleId) await send("update-rule", { rule });
    else {
      const checked = [...elements.compatible.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
      await send("create-rules", { targetKeys: [target.key, ...checked], rule });
    }
    resetEditor();
  } catch (error) {
    elements.error.textContent = error instanceof Error ? error.message : "規則內容不正確";
    if (error instanceof RuleDraftError && error.field === "threshold") markDraftFieldError(elements.genericThreshold);
  }
}

function editRule(ruleId) {
  const rule = status.rules.find((item) => item.id === ruleId);
  if (!rule) return;
  editingRuleId = rule.id;
  elements.editorTitle.textContent = "修改提醒規則";
  elements.save.textContent = "儲存修改";
  elements.cancel.hidden = false;
  elements.target.value = rule.targetKey;
  elements.target.disabled = true;
  if (rule.mode === "depth-ratio") {
    elements.depthLabel.value = String(rule.depthLabel);
    elements.splitSides.checked = rule.splitSides;
    fillLevels(elements.sharedLevels, rule.levels);
    fillLevels(elements.buyLevels, rule.buyLevels);
    fillLevels(elements.sellLevels, rule.sellLevels);
    elements.depthSound.checked = rule.soundEnabled !== false;
    elements.depthNotification.checked = rule.notificationEnabled !== false;
    updateDepthEditor();
  } else {
    elements.genericKind.value = rule.condition.kind;
    elements.genericThreshold.value = String(rule.condition.threshold);
    elements.genericSound.checked = rule.soundEnabled !== false;
  }
  renderTargetDetails();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetEditor() {
  editingRuleId = null;
  elements.editorTitle.textContent = "新增提醒規則";
  elements.save.textContent = "建立規則";
  elements.cancel.hidden = true;
  elements.target.disabled = false;
  elements.depthLabel.value = "10";
  elements.splitSides.checked = false;
  fillLevels(elements.sharedLevels, DEFAULT_LEVELS);
  fillLevels(elements.buyLevels, DEFAULT_LEVELS);
  fillLevels(elements.sellLevels, DEFAULT_LEVELS);
  elements.depthSound.checked = true;
  elements.depthNotification.checked = true;
  elements.genericKind.value = "above";
  elements.genericThreshold.value = "";
  elements.genericSound.checked = true;
  elements.error.textContent = "";
  clearDraftFieldError(elements.genericThreshold);
  updateDepthEditor();
  renderTargetDetails();
}

uiPort.onMessage.addListener((message) => { if (message?.type === "status") { status = message.payload; render(); } });
send("get-status").then((response) => { status = response.status; render(); resetEditor(); }).catch((error) => showSideError(error.message));
elements.pin.addEventListener("click", async () => {
  try {
    let response = await chrome.runtime.sendMessage({ type: "pin-current" });
    if (response?.needsConfirm && confirm("要改為釘選目前的 CoinGlass 頁面嗎？")) response = await chrome.runtime.sendMessage({ type: "pin-current", confirm: true });
    if (!response?.ok && !response?.needsConfirm) throw new Error(response?.error ?? "釘選失敗");
  } catch (error) { alert(error instanceof Error ? error.message : "釘選失敗"); }
});
elements.scan.addEventListener("click", () => send("scan-now").catch((error) => alert(error.message)));
elements.pause.addEventListener("click", () => send("set-paused", { paused: !status.preferences.paused }).catch((error) => alert(error.message)));
elements.notifications.addEventListener("click", () => send("set-notifications", { enabled: !status.preferences.notificationsEnabled }).catch((error) => alert(error.message)));
elements.testSound.addEventListener("click", async () => {
  elements.testSound.disabled = true;
  elements.audioStatus.textContent = "正在測試聲音…";
  try {
    await send("play-test-sound", { events: ["direction-buy", "buy3"] });
  } catch (error) {
    elements.audioStatus.textContent = `播放失敗：${error instanceof Error ? error.message : "未知錯誤"}`;
    elements.audioStatus.className = "audio-status error";
  } finally {
    elements.testSound.disabled = false;
  }
});
elements.openSide.addEventListener("click", () => { elements.sideError.hidden = true; openSidePanel(chrome, currentWindowId).then(() => window.close()).catch((error) => showSideError(error instanceof Error ? error.message : "無法開啟")); });
elements.target.addEventListener("change", renderTargetDetails);
elements.splitSides.addEventListener("change", () => { if (elements.splitSides.checked) { fillLevels(elements.buyLevels, levelsFrom(elements.sharedLevels)); fillLevels(elements.sellLevels, levelsFrom(elements.sharedLevels)); } updateDepthEditor(); });
elements.genericThreshold.addEventListener("input", () => { elements.error.textContent = ""; clearDraftFieldError(elements.genericThreshold); });
elements.save.addEventListener("click", saveRule);
elements.cancel.addEventListener("click", resetEditor);
elements.rules.addEventListener("change", (event) => { const item = event.target.closest(".rule-item"); if (event.target.matches(".rule-enabled") && item) void send("set-rule-enabled", { ruleId: item.dataset.ruleId, enabled: event.target.checked }); });
elements.rules.addEventListener("click", (event) => { const button = event.target.closest("button[data-action]"); const item = button?.closest(".rule-item"); if (!button || !item) return; if (button.dataset.action === "edit") editRule(item.dataset.ruleId); if (button.dataset.action === "delete" && confirm("確定要刪除這條提醒規則嗎？")) void send("delete-rule", { ruleId: item.dataset.ruleId }); });
elements.clearHistory.addEventListener("click", () => { if (confirm("確定要清除所有插件提醒紀錄嗎？")) void send("clear-history"); });
