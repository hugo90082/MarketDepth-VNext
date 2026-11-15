import {
  buildTargetCatalog,
  compatibleTarget,
} from "./lib/catalog.js";
import { buildAlertRecord } from "./lib/alert-event.js";
import {
  bridgeAllowsCommand,
  buildWebsiteSnapshotPayload,
  envelope,
  readBridgeCapabilities,
  validateEnvelope,
} from "./lib/bridge.js";
import { classifyIndicatorTarget } from "./lib/indicator-mode.js";
import { createUpdatedDepthProfile } from "./lib/depth-profile.js";
import { advanceGapState, intervalToMs } from "./lib/gap.js";
import { evaluateRules, resetAfterReload } from "./lib/rule-engine.js";
import { advanceRecoveryDecision } from "./lib/recovery.js";
import { createAudioPlaybackController } from "./lib/audio-playback.js";
import { dispatchAlertChannels } from "./lib/alert-dispatch.js";
import { ensureBuiltInDefaults } from "./lib/built-in-defaults.js";
import { prepareDormantReload, shouldReloadDormant } from "./lib/dormant-recovery.js";
import {
  RULE_LIMIT,
  appendHistory,
  createDefaultState,
  depthLabelConflict,
  exportSettingsBackup,
  normalizeRule,
  normalizeSettingsBackup,
} from "./lib/settings.js";
import { resolvePendingRuleTemplates } from "./lib/portable-template.js";

const STORAGE_KEY = "coinglassIndicatorAlertState";
const CAPTURE_ALARM = "coinglass-indicator-capture";
const SUPPORTED_URL = /^https:\/\/www\.coinglass\.com\/tv\/zh-TW\//;
const MESSAGE_TIMEOUT_MS = 10_000;
const FULL_RESCAN_MS = 60_000;
const RELOAD_INTERVAL_MS = 60_000;
const extensionVersion = chrome.runtime.getManifest().version;

let state = createDefaultState();
let catalog = { targets: [], ambiguousKeys: [], errors: [] };
let health = {
  status: "idle",
  dormantCount: 0,
  error: "",
  capturedAt: 0,
  reloadAttempts: 0,
  successStreak: 0,
  failureStreak: 0,
};
let audioHealth = {
  status: "idle",
  error: "",
  lastPlayedAt: 0,
};
let captureWork;
let queuedFullScan = false;
let frameIds = [];
let lastFullScanAt = 0;
let lastHeartbeatAt = Date.now();
let lastReloadAt = 0;
let lastDormantReloadAt = 0;
let lastDormantSignature = "";
let preserveStatesForDormantReload = null;
let fatalNotified = false;
let navigationGeneration = 0;
const gapStates = new Map();
const invalidCounts = new Map();
const uiPorts = new Set();
const bridgePorts = new Map();
const audioPlayback = createAudioPlaybackController({ chromeApi: chrome });

function clearDormantRecovery() {
  lastDormantReloadAt = 0;
  lastDormantSignature = "";
  state.dormantRecovery = { lastReloadAt: 0, signature: "" };
  preserveStatesForDormantReload = null;
}

const ready = loadState().then(async () => {
  const defaults = ensureBuiltInDefaults(state);
  if (defaults.changed) {
    state = defaults.state;
    state.revision += 1;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }
  await restorePinnedTab();
  await chrome.alarms.create(CAPTURE_ALARM, { periodInMinutes: 0.5 });
  await refreshBadge();
}).catch((error) => {
  health = { ...health, status: "error", error: error instanceof Error ? error.message : "插件初始化失敗" };
});

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const saved = stored?.[STORAGE_KEY];
  if (!saved || typeof saved !== "object") return;
  try {
    const legacy = Number(saved.schemaVersion) !== 2;
    const settings = normalizeSettingsBackup(saved);
    const normalizedRuleIds = new Set(settings.rules.map((rule) => rule.id));
    const savedRuleStates = saved.ruleStates && typeof saved.ruleStates === "object"
      ? saved.ruleStates
      : {};
    const ruleStates = Object.fromEntries(
      Object.entries(savedRuleStates).filter(([ruleId]) => normalizedRuleIds.has(ruleId)),
    );
    const migrationChanged = legacy || JSON.stringify(saved.rules ?? []) !== JSON.stringify(settings.rules);
    state = {
      ...createDefaultState(),
      ...settings,
      revision: settings.revision,
      updatedAt: migrationChanged ? Date.now() : settings.updatedAt,
      pinnedPage: saved.pinnedPage && typeof saved.pinnedPage === "object"
        ? { ...settings.pinnedPage, tabId: Number.isInteger(saved.pinnedPage.tabId) ? saved.pinnedPage.tabId : null }
        : null,
      history: legacy ? [] : appendHistory([], Array.isArray(saved.history) ? saved.history : []),
      historyRevision: Math.max(0, Number(saved.historyRevision) || 0) + (legacy ? 1 : 0),
      ruleStates: legacy ? {} : ruleStates,
      dormantRecovery: {
        lastReloadAt: Math.max(0, Number(saved.dormantRecovery?.lastReloadAt) || 0),
        signature: typeof saved.dormantRecovery?.signature === "string"
          ? saved.dormantRecovery.signature.slice(0, 20_000)
          : "",
      },
    };
    lastDormantReloadAt = state.dormantRecovery.lastReloadAt;
    lastDormantSignature = state.dormantRecovery.signature;
    if (migrationChanged) await chrome.storage.local.set({ [STORAGE_KEY]: state });
  } catch {
    state = createDefaultState();
  }
}

async function persist({ settingsChanged = false, broadcast = true } = {}) {
  if (settingsChanged) {
    state.revision += 1;
    state.updatedAt = Date.now();
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  if (broadcast) broadcastAll();
}

function publicStatus() {
  const settingsBackup = exportSettingsBackup(state);
  return {
    extensionVersion,
    pinnedPage: state.pinnedPage,
    rules: state.rules,
    preferences: state.preferences,
    history: state.history,
    historyRevision: state.historyRevision,
    catalog,
    health,
    audioHealth,
    settingsBackup,
    depthProfile: state.depthProfile,
    builtInDefaults: {
      version: state.preferences.builtInDefaultsVersion,
      pendingCount: state.pendingRuleTemplates.length,
    },
  };
}

function broadcastAll() {
  const status = publicStatus();
  for (const port of uiPorts) {
    try { port.postMessage({ type: "status", payload: status }); } catch { /* disconnected */ }
  }
  for (const [port, capabilities] of bridgePorts) {
    try {
      port.postMessage(envelope(
        "plugin-snapshot",
        state.historyRevision,
        buildWebsiteSnapshotPayload(status, capabilities),
      ));
    } catch { /* disconnected */ }
  }
}

function isSupportedUrl(url) {
  return typeof url === "string" && SUPPORTED_URL.test(url);
}

async function restorePinnedTab() {
  if (!state.pinnedPage?.url || state.pinnedPage.tabId) return;
  const tabs = (await chrome.tabs.query({ url: state.pinnedPage.url }))
    .filter((tab) => !tab.incognito && isSupportedUrl(tab.url));
  if (tabs.length !== 1) return;
  state.pinnedPage = { tabId: tabs[0].id, url: tabs[0].url, title: tabs[0].title ?? state.pinnedPage.title };
  await chrome.tabs.update(tabs[0].id, { autoDiscardable: false }).catch(() => undefined);
  await persist({ settingsChanged: false, broadcast: false });
}

async function pinCurrentTab(confirmReplace = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id) || tab.incognito || !isSupportedUrl(tab.url)) {
    throw new Error("請先開啟 zh-TW CoinGlass TV 圖表頁");
  }
  if (state.pinnedPage?.tabId && state.pinnedPage.tabId !== tab.id && !confirmReplace) {
    return { needsConfirm: true, current: state.pinnedPage, next: { tabId: tab.id, url: tab.url, title: tab.title } };
  }
  state.pinnedPage = { tabId: tab.id, url: tab.url, title: tab.title ?? "CoinGlass" };
  state.preferences.onboarding.pinned = true;
  state.ruleStates = resetAfterReload(state.ruleStates, state.rules);
  clearDormantRecovery();
  frameIds = [];
  lastFullScanAt = 0;
  health = { ...health, status: "loading", error: "", reloadAttempts: 0, successStreak: 0 };
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
  await persist({ settingsChanged: true });
  void capture(true);
  return { ok: true };
}

async function ensurePinnedTab() {
  if (!state.pinnedPage?.tabId) await restorePinnedTab();
  if (!state.pinnedPage?.tabId) throw new Error("尚未釘選 CoinGlass 頁面");
  const tab = await chrome.tabs.get(state.pinnedPage.tabId).catch(() => null);
  if (!tab || !isSupportedUrl(tab.url)) throw new Error("釘選頁面已關閉或不是 zh-TW CoinGlass TV 頁面");
  if (tab.url !== state.pinnedPage.url || tab.title !== state.pinnedPage.title) {
    state.pinnedPage = { tabId: tab.id, url: tab.url, title: tab.title ?? "CoinGlass" };
    await persist({ settingsChanged: true, broadcast: false });
  }
  return tab;
}

async function withTimeout(work, timeoutMs = MESSAGE_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("CoinGlass 圖表回應逾時")), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function sendFrameCommand(tabId, frameId, action, payload = {}) {
  const response = await withTimeout(chrome.tabs.sendMessage(
    tabId,
    { type: "coinglass-indicator-frame-command", action, ...payload },
    { frameId },
  ));
  if (!response?.ok) throw new Error(response?.error ?? "CoinGlass frame 讀取失敗");
  return response.value;
}

async function discoverFrames(tabId) {
  const injections = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["coinglass-frame.js"],
  });
  frameIds = [...new Set(injections
    .filter((entry) => entry.result === "coinglass-indicator-frame" && Number.isInteger(entry.frameId))
    .map((entry) => entry.frameId))];
  if (!frameIds.length) throw new Error("找不到 CoinGlass Financial Chart");
}

async function readFrames(tabId, forceFull) {
  if (forceFull || !frameIds.length) await discoverFrames(tabId);
  const selectedFrameIds = forceFull || !state.rules.some((rule) => rule.enabled)
    ? frameIds
    : [...new Set(state.rules.filter((rule) => rule.enabled).map((rule) => (
        catalog.targets.find((target) => target.key === rule.targetKey)?.frameId
      )).filter(Number.isInteger))];
  const ids = selectedFrameIds.length ? selectedFrameIds : frameIds;
  const results = await Promise.allSettled(ids.map(async (frameId) => {
    await sendFrameCommand(tabId, frameId, "clear-crosshair");
    const filters = forceFull ? [] : state.rules
      .filter((rule) => rule.enabled)
      .map((rule) => catalog.targets.find((target) => target.key === rule.targetKey))
      .filter((target) => target?.frameId === frameId)
      .map((target) => ({
        paneOrdinal: target.paneOrdinal,
        indicatorOrdinal: target.indicatorOrdinal,
        indicator: target.indicator,
        params: target.params,
        output: target.output,
        outputIndex: target.outputIndex,
      }));
    const snapshot = await sendFrameCommand(tabId, frameId, "read", { filters });
    return { frameId, chartOrdinal: frameIds.indexOf(frameId), ...snapshot };
  }));
  const frames = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!frames.length) throw new Error("所有 CoinGlass 圖表都無法讀取");
  return frames;
}

async function captureRound(forceFull = false) {
  await ready;
  if (state.preferences.paused) {
    await ensurePinnedTab().catch(() => undefined);
    return;
  }
  const now = Date.now();
  const heartbeatGapMs = now - lastHeartbeatAt;
  lastHeartbeatAt = now;
  try {
    const tab = await ensurePinnedTab();
    const generation = navigationGeneration;
    const full = forceFull || now - lastFullScanAt >= FULL_RESCAN_MS || !catalog.targets.length;
    const frames = await readFrames(tab.id, full);
    if (generation !== navigationGeneration) return;
    const nextCatalog = buildTargetCatalog(frames);
    if (full) {
      catalog = nextCatalog;
      lastFullScanAt = now;
    } else {
      const byKey = new Map(catalog.targets.map((target) => [target.key, target]));
      for (const target of nextCatalog.targets) byKey.set(target.key, target);
      catalog = { ...nextCatalog, targets: [...byKey.values()] };
    }

    const resolvedPending = resolvePendingRuleTemplates({
      pending: state.pendingRuleTemplates,
      rules: state.rules,
      catalog: catalog.targets,
    });
    const newlyResolvedRuleIds = new Set(
      resolvedPending.rules.slice(state.rules.length).map((rule) => rule.id),
    );
    if (resolvedPending.matchedCount > 0) {
      state.rules = resolvedPending.rules;
      state.pendingRuleTemplates = resolvedPending.pending;
      await persist({ settingsChanged: true, broadcast: false });
    }

    const samples = {};
    let dormantCount = 0;
    const dormantRuleIds = [];
    let trustedGap = false;
    for (const rule of state.rules.filter((item) => item.enabled)) {
      if (newlyResolvedRuleIds.has(rule.id)) continue;
      const target = catalog.targets.find((item) => item.key === rule.targetKey);
      if (!target || target.status !== "ok" || catalog.ambiguousKeys.includes(rule.targetKey)) {
        dormantCount += 1;
        dormantRuleIds.push(rule.id);
        const previousInvalid = invalidCounts.get(rule.targetKey) ?? 0;
        invalidCounts.set(rule.targetKey, previousInvalid > 0 ? previousInvalid + 1 : 1);
        continue;
      }
      const invalidCount = invalidCounts.get(rule.targetKey) ?? 0;
      if (invalidCount > 0) {
        invalidCounts.set(rule.targetKey, -1);
        dormantCount += 1;
        dormantRuleIds.push(rule.id);
        continue;
      }
      invalidCounts.set(rule.targetKey, 0);
      samples[rule.targetKey] = { value: target.value, displayValue: target.displayValue, capturedAt: now };
      const gap = advanceGapState(gapStates.get(rule.targetKey), {
        now,
        valid: true,
        intervalMs: intervalToMs(target.interval),
        heartbeatGapMs,
      });
      gapStates.set(rule.targetKey, gap);
      trustedGap ||= gap.gapDetected;
    }

    const evaluation = evaluateRules({
      rules: state.rules,
      samples,
      states: state.ruleStates,
      now,
      globalLevels: state.depthProfile.levels,
    });
    state.ruleStates = evaluation.states;
    const events = evaluation.events.flatMap((event) => {
      const target = catalog.targets.find((item) => item.key === event.targetKey);
      return target ? [buildAlertRecord(event, target)] : [];
    });
    if (events.length) {
      state.history = appendHistory(state.history, events);
      state.historyRevision += 1;
      await dispatchAlerts(events);
    }

    const recovery = advanceRecoveryDecision(health, { success: true, trustedGap });
    health = {
      ...health,
      status: dormantCount ? "dormant" : "ok",
      dormantCount,
      error: trustedGap ? "偵測到可信的週期缺口" : "",
      capturedAt: now,
      successStreak: health.successStreak + 1,
      failureStreak: recovery.failureStreak,
    };
    if (health.successStreak >= 2 && !trustedGap) {
      health.reloadAttempts = 0;
      fatalNotified = false;
    }
    await persist({ settingsChanged: false });
    await refreshBadge();
    const dormantReloaded = await attemptDormantRecovery(dormantRuleIds, now);
    if (recovery.shouldRecover && !dormantReloaded) await attemptRecovery("偵測到可信的週期缺口");
  } catch (error) {
    const recovery = advanceRecoveryDecision(health, { success: false });
    health = {
      ...health,
      status: "error",
      error: error instanceof Error ? error.message : "CoinGlass 擷取失敗",
      capturedAt: now,
      successStreak: 0,
      failureStreak: recovery.failureStreak,
    };
    await persist({ settingsChanged: false });
    await refreshBadge();
    if (recovery.shouldRecover) await attemptRecovery(health.error);
  }
}

function capture(forceFull = false) {
  if (captureWork) {
    queuedFullScan ||= forceFull;
    return captureWork;
  }
  captureWork = captureRound(forceFull).finally(() => {
    captureWork = undefined;
    if (queuedFullScan) {
      queuedFullScan = false;
      void capture(true);
    }
  });
  return captureWork;
}

async function attemptRecovery(reason) {
  if (state.preferences.paused || !state.pinnedPage?.tabId) return;
  const now = Date.now();
  if (now - lastReloadAt < RELOAD_INTERVAL_MS) return;
  if (health.reloadAttempts >= 3) {
    health.status = "fatal";
    health.error = reason;
    await refreshBadge();
    if (!fatalNotified) {
      fatalNotified = true;
      await createStatusNotification("CoinGlass 監控已停止", "自動重新載入三次仍無法恢復，請開啟插件重新偵測。");
    }
    broadcastAll();
    return;
  }
  lastReloadAt = now;
  health.reloadAttempts += 1;
  state.ruleStates = resetAfterReload(state.ruleStates, state.rules);
  frameIds = [];
  await chrome.tabs.reload(state.pinnedPage.tabId).catch(() => undefined);
  await persist({ settingsChanged: false });
}

async function attemptDormantRecovery(dormantRuleIds, now = Date.now()) {
  const signature = [...new Set(dormantRuleIds)].sort().join("|");
  if (!signature) {
    const changed = Boolean(lastDormantSignature || lastDormantReloadAt);
    lastDormantSignature = "";
    lastDormantReloadAt = 0;
    state.dormantRecovery = { lastReloadAt: 0, signature: "" };
    if (changed) await persist({ settingsChanged: false });
    return false;
  }
  const changed = signature !== lastDormantSignature;
  if (changed) lastDormantReloadAt = 0;
  lastDormantSignature = signature;
  state.dormantRecovery = { lastReloadAt: lastDormantReloadAt, signature };
  if (!shouldReloadDormant({
    dormantRuleIds,
    now,
    lastReloadAt: lastDormantReloadAt,
    paused: state.preferences.paused,
    hasPinnedTab: Boolean(state.pinnedPage?.tabId),
  })) {
    if (changed) await persist({ settingsChanged: false });
    return false;
  }
  const tabId = state.pinnedPage.tabId;
  lastDormantReloadAt = now;
  state.dormantRecovery = { lastReloadAt: now, signature };
  state.ruleStates = prepareDormantReload(state.ruleStates, dormantRuleIds);
  preserveStatesForDormantReload = { tabId, until: now + 30_000 };
  frameIds = [];
  catalog = { targets: [], ambiguousKeys: [], errors: [] };
  await persist({ settingsChanged: false });
  try {
    await chrome.tabs.reload(tabId);
    return true;
  } catch {
    preserveStatesForDormantReload = null;
    return false;
  }
}

async function dispatchAlerts(events) {
  if (!events.length) return;
  const result = await dispatchAlertChannels({
    events,
    notificationsEnabled: state.preferences.notificationsEnabled,
    playAudio: playSound,
    sendNotification: sendSystemNotification,
  });
  if (result.audibleCount) {
    audioHealth = result.audioError
      ? { ...audioHealth, status: "error", error: result.audioError.message }
      : { status: "ready", error: "", lastPlayedAt: Date.now() };
    broadcastAll();
  }
}

async function sendSystemNotification(event) {
  await chrome.notifications.create(`coinglass-alert-${event.id ?? `${Date.now()}-${crypto.randomUUID()}`}`, {
    type: "basic",
    iconUrl: "icon.svg",
    title: "CoinGlass 指標提醒",
    message: event.ruleName,
    priority: 2,
  }).catch(() => undefined);
}

async function createStatusNotification(title, message) {
  if (!state.preferences.notificationsEnabled) return;
  await chrome.notifications.create(`coinglass-status-${Date.now()}`, {
    type: "basic", iconUrl: "icon.svg", title, message, priority: 1,
  }).catch(() => undefined);
}

async function playSound(events) {
  return audioPlayback.play(events);
}

async function refreshBadge() {
  if (state.preferences.paused) {
    await chrome.action.setBadgeText({ text: "Ⅱ" });
    await chrome.action.setBadgeBackgroundColor({ color: "#747a94" });
    return;
  }
  if (health.status === "fatal") {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93653" });
    return;
  }
  if (health.status === "error") {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#e0a300" });
    return;
  }
  if (health.dormantCount) {
    await chrome.action.setBadgeText({ text: String(Math.min(999, health.dormantCount)) });
    await chrome.action.setBadgeBackgroundColor({ color: "#e0a300" });
    return;
  }
  await chrome.action.setBadgeText({ text: health.status === "ok" ? "✓" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#08a979" });
}

async function createRules(message) {
  const targetKeys = Array.isArray(message.targetKeys) ? [...new Set(message.targetKeys)] : [];
  const primary = catalog.targets.find((target) => target.key === targetKeys[0]);
  if (!primary) throw new Error("請先選擇有效指標輸出");
  const compatible = targetKeys.map((key) => catalog.targets.find((target) => target.key === key));
  if (compatible.some((target) => !target || !compatibleTarget(primary, target))) throw new Error("批次目標的指標、參數、輸出與單位必須相同");
  if (state.rules.length + targetKeys.length > RULE_LIMIT) throw new Error("最多只能保存 200 條規則");
  const nextRules = compatible.map((target) => normalizeRule({
      ...message.rule,
      id: crypto.randomUUID(),
      mode: classifyIndicatorTarget(target),
      targetKey: target.key,
      unit: target.unit,
      targetMeta: target,
    }));
  const prospective = [...state.rules];
  for (const rule of nextRules) {
    if (depthLabelConflict(prospective, rule)) throw new Error(`${rule.targetMeta?.symbol ?? "商品"} 已有相同深度標籤`);
    prospective.push(rule);
  }
  state.rules = prospective;
  await persist({ settingsChanged: true });
  return { ok: true };
}

async function replaceSettings(backup) {
  const normalized = normalizeSettingsBackup(backup);
  state.rules = normalized.rules;
  state.preferences = normalized.preferences;
  state.depthProfile = normalized.depthProfile;
  state.pendingRuleTemplates = normalized.pendingRuleTemplates;
  state.pinnedPage = normalized.pinnedPage ? { ...normalized.pinnedPage, tabId: null } : null;
  state.ruleStates = {};
  clearDormantRecovery();
  state.revision = Math.max(state.revision, normalized.revision) + 1;
  state.updatedAt = Date.now();
  frameIds = [];
  catalog = { targets: [], ambiguousKeys: [], errors: [] };
  state = ensureBuiltInDefaults(state).state;
  await restorePinnedTab();
  await persist({ settingsChanged: false });
  void capture(true);
}

async function handleCommand(message) {
  await ready;
  if (message?.type === "get-status") return { ok: true, status: publicStatus() };
  if (message?.type === "pin-current") return pinCurrentTab(message.confirm === true);
  if (message?.type === "scan-now") { await capture(true); return { ok: true }; }
  if (message?.type === "create-rules") return createRules(message);
  if (message?.type === "update-rule") {
    const index = state.rules.findIndex((rule) => rule.id === message.rule?.id);
    if (index < 0) throw new Error("找不到規則");
    const next = normalizeRule({
      ...state.rules[index],
      ...message.rule,
      id: state.rules[index].id,
      mode: state.rules[index].mode,
      targetKey: state.rules[index].targetKey,
      targetMeta: state.rules[index].targetMeta,
    });
    if (depthLabelConflict(state.rules, next)) throw new Error(`${next.targetMeta?.symbol ?? "商品"} 已有相同深度標籤`);
    state.rules[index] = next;
    delete state.ruleStates[state.rules[index].id];
    await persist({ settingsChanged: true });
    return { ok: true };
  }
  if (message?.type === "delete-rule") {
    state.rules = state.rules.filter((rule) => rule.id !== message.ruleId);
    delete state.ruleStates[message.ruleId];
    await persist({ settingsChanged: true });
    return { ok: true };
  }
  if (message?.type === "set-rule-enabled") {
    const rule = state.rules.find((item) => item.id === message.ruleId);
    if (!rule) throw new Error("找不到規則");
    rule.enabled = message.enabled === true;
    delete state.ruleStates[rule.id];
    await persist({ settingsChanged: true });
    return { ok: true };
  }
  if (message?.type === "set-paused") {
    state.preferences.paused = message.paused === true;
    state.ruleStates = resetAfterReload(state.ruleStates, state.rules);
    clearDormantRecovery();
    await persist({ settingsChanged: true });
    await refreshBadge();
    if (!state.preferences.paused) void capture(true);
    return { ok: true };
  }
  if (message?.type === "set-notifications") {
    state.preferences.notificationsEnabled = message.enabled === true;
    state.preferences.onboarding.notificationsChecked = true;
    await persist({ settingsChanged: true });
    return { ok: true };
  }
  if (message?.type === "play-test-sound") {
    try {
      const playback = await playSound(Array.isArray(message.events) ? message.events : ["buy3"]);
      audioHealth = { status: "ready", error: "", lastPlayedAt: Date.now() };
      state.preferences.onboarding.soundChecked = true;
      await persist({ settingsChanged: true });
      return { ok: true, audio: playback };
    } catch (error) {
      audioHealth = {
        ...audioHealth,
        status: "error",
        error: error instanceof Error ? error.message : "聲音播放失敗",
      };
      broadcastAll();
      throw error;
    }
  }
  if (message?.type === "clear-history") {
    state.history = [];
    state.historyRevision += 1;
    await persist({ settingsChanged: false });
    return { ok: true };
  }
  if (message?.type === "set-depth-profile") {
    state.depthProfile = createUpdatedDepthProfile(
      state.depthProfile,
      message.levels,
      "extension",
    );
    state.ruleStates = {};
    await persist({ settingsChanged: true });
    return { ok: true, depthProfile: state.depthProfile };
  }
  throw new Error("不支援的插件命令");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "capture-tick") {
    if (sender.tab?.id === state.pinnedPage?.tabId && message.visible) void capture(false);
    return false;
  }
  if (message?.type === "pinned-page-navigated") {
    if (sender.tab?.id === state.pinnedPage?.tabId) {
      navigationGeneration += 1;
      frameIds = [];
      catalog = { targets: [], ambiguousKeys: [], errors: [] };
      health = { ...health, status: "loading", error: "頁面切換中", successStreak: 0, failureStreak: 0 };
      const preserving = preserveStatesForDormantReload?.tabId === sender.tab.id
        && Date.now() <= preserveStatesForDormantReload.until;
      if (!preserving) state.ruleStates = resetAfterReload(state.ruleStates, state.rules);
      void capture(true);
    }
    return false;
  }
  if (message?.type === "play-sound" || message?.type === "audio-ping") return false;
  handleCommand(message).then(sendResponse).catch((error) => sendResponse({
    ok: false,
    error: error instanceof Error ? error.message : "插件操作失敗",
  }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "indicator-ui") {
    uiPorts.add(port);
    ready.then(() => port.postMessage({ type: "status", payload: publicStatus() }));
    port.onDisconnect.addListener(() => uiPorts.delete(port));
    return;
  }
  if (port.name !== "depthwatch-alert-bridge") return;
  bridgePorts.set(port, { independentThresholds: false });
  ready.then(() => broadcastAll());
  port.onMessage.addListener((message) => {
    if (!validateEnvelope(message)) return;
    if (!bridgeAllowsCommand(message.type)) return;
    if (message.type === "hello") {
      bridgePorts.set(port, readBridgeCapabilities(message.payload));
      broadcastAll();
    }
    if (message.type === "clear-plugin-history") void handleCommand({ type: "clear-history" });
    if (message.type === "restore-settings") {
      void replaceSettings(message.payload).catch(() => undefined);
    }
  });
  port.onDisconnect.addListener(() => {
    bridgePorts.delete(port);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CAPTURE_ALARM) void capture(Date.now() - lastFullScanAt >= FULL_RESCAN_MS);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== state.pinnedPage?.tabId) return;
  state.pinnedPage = { ...state.pinnedPage, tabId: null };
  health = { ...health, status: "fatal", error: "釘選的 CoinGlass 分頁已關閉" };
  frameIds = [];
  void persist({ settingsChanged: false });
  void refreshBadge();
  void createStatusNotification("CoinGlass 監控已停止", "釘選的 CoinGlass 分頁已關閉，請重新開啟並釘選。");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== state.pinnedPage?.tabId) return;
  if (changeInfo.url || changeInfo.status === "complete") {
    navigationGeneration += 1;
    state.pinnedPage = { tabId, url: tab.url, title: tab.title ?? state.pinnedPage.title };
    frameIds = [];
    catalog = { targets: [], ambiguousKeys: [], errors: [] };
    health = { ...health, status: "loading", error: "頁面切換中", successStreak: 0, failureStreak: 0 };
    const preserving = preserveStatesForDormantReload?.tabId === tabId
      && Date.now() <= preserveStatesForDormantReload.until;
    if (!preserving) state.ruleStates = resetAfterReload(state.ruleStates, state.rules);
    if (preserving && changeInfo.status === "complete") preserveStatesForDormantReload = null;
    void persist({ settingsChanged: true });
    if (changeInfo.status === "complete") void capture(true);
  }
});

chrome.notifications.onClicked.addListener(async () => {
  try {
    const window = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: window.id });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL("ui/index.html") });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(CAPTURE_ALARM, { periodInMinutes: 0.5 });
});
