import {marketRuntime} from '../runtime/client';
import {CORE_SYMBOLS} from '../../shared/runtime-policy';
"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertLogPanel, ScheduleSettingsCard } from "./alert-log-panel";
import { createAlertRuntime } from "./alert-runtime";
import { createBrowserAlertSoundPlayer, type AlertSoundPlayer } from "./alert-sound";
import type { AlertEvent } from "./alert-policy";
import { aggregateSortValue, parseAggregateSortKey, visibleAggregateDepths } from "./aggregate-depth-view";
import { CoinAlertDialog } from "./coin-alert-dialog";
import { loadBinancePerpetuals, loadBrowserDepth, loadBrowserMarketMeta, mergeCloudFallbacks, missingBrowserExchanges, selectDepth } from "./depth-browser";
import { runLayeredDepthRound } from "./depth-round";
import { DepthTable } from "./depth-table";
import {
  DEFAULT_COINS,
  DEFAULT_GAP_SECONDS,
  DEFAULT_LEVELS,
  DEFAULT_REFRESH_SECONDS,
  MAX_SYMBOLS,
  SETTINGS_KEY,
  createDepthSlots,
  emptyAlert,
  loadDepthSettings,
  saveDepthSettings,
  type AlertConfig,
  type AggregateDepthSlot,
  type AlertLogEntry,
  type AlertLogTone,
  type AlertLogType,
  type Levels,
} from "./depth-settings";
import {
  filterMarketOptions,
  INITIAL_CLOCK_OVERLAY_STATE,
  isClockOverlayVisible,
  isLogAtBottom,
  reduceClockOverlay,
  trimHistory,
  type SearchableMarket,
} from "./depth-ui";
import { type DepthOption, type DepthResponse, type SourceResult } from "./depth-types";
import {
  EXCHANGES,
  blankRow,
  symbolCompare,
  type BaseSortKey,
  type CoinRow,
  type Exchange,
  type SortKey,
} from "./depth-view-model";
import { MonitorToolbar } from "./monitor-toolbar";
import {
  PLUGIN_EXTENSION_SOURCE,
  PLUGIN_PAGE_SOURCE,
  clearPluginMirror,
  comparePluginBackups,
  createPluginHelloEnvelope,
  createPageEnvelope,
  combineDisplayedHistory,
  normalizePluginSnapshot,
  readPluginBackup,
  readPluginHistory,
  shouldStorePluginBackup,
  writePluginBackup,
  writePluginHistory,
  type ExtensionAlertEvent,
  type PluginConnection,
  type PluginSettingsBackup,
} from "./plugin-alert-bridge";
import { SoundPreviewDialog } from "./sound-preview-dialog";
import { resolveMarketMeta, type MarketMetaBatchResponse, type MarketMetaDisplay } from "./market-meta";
import { getMarketDirectory } from "./market-catalog";
import { DEFAULT_COLUMN_ORDER, moveOrderItem, normalizeRowOrder, type ColumnBlock } from "./table-layout";
import { createTabCoordinator } from "./tab-coordinator";
import { createUpdateScheduler } from "./update-scheduler";
import { SHARED_DEPTH_PROFILE_KEY } from "./shared-depth-profile";

type MarketDirectoryResponse = {
  items: SearchableMarket[];
  sources?: Array<{ exchange: string; status: "ok" | "stale" | "error"; error?: string }>;
  error?: string;
};

const MARKET_REFRESH_MS = 6 * 60 * 60 * 1000;

function formatClock(value: number) {
  if (!value) return "0000/00/00 00:00:00";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}
function formatCompactClock(value: number) {
  if (!value) return "00/00 00:00:00";
  const full = formatClock(value);
  return full.slice(5);
}
function clockParts(value: number) {
  const full = formatClock(value);
  const [date, time] = full.split(" ");
  return { date, time };
}
function signatureOf(sources: SourceResult[]) {
  return sources.map((source) => `${source.exchange}:${source.feed ?? "rest"}:${source.completeness ?? source.status}`).join("|");
}

export function useMonitorRuntime(render: boolean, navigation?: ReactNode) {
  const [symbols, setSymbols] = useState(DEFAULT_COINS);
  const [rows, setRows] = useState<Record<string, CoinRow>>({});
  const [depth, setDepth] = useState<DepthOption>(10);
  const [aggregateDepthSlots, setAggregateDepthSlots] = useState<AggregateDepthSlot[]>(() => createDepthSlots(10));
  const [globalLevels, setGlobalLevels] = useState<Levels>({ ...DEFAULT_LEVELS });
  const [refreshSeconds, setRefreshSeconds] = useState(DEFAULT_REFRESH_SECONDS);
  const [gapSeconds, setGapSeconds] = useState(DEFAULT_GAP_SECONDS);
  const [refreshDraft, setRefreshDraft] = useState(String(DEFAULT_REFRESH_SECONDS));
  const [gapDraft, setGapDraft] = useState(String(DEFAULT_GAP_SECONDS));
  const [pausedSymbols, setPausedSymbols] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "symbol", dir: 1 });
  const [newCoin, setNewCoin] = useState("");
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [marketOptions, setMarketOptions] = useState<SearchableMarket[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [marketMenu, setMarketMenu] = useState(false);
  const [marketIndex, setMarketIndex] = useState(-1);
  const [settings, setSettings] = useState<string | null>(null);
  const [alertHistory, setAlertHistory] = useState<AlertLogEntry[]>([]);
  const [pluginHistory, setPluginHistory] = useState<ExtensionAlertEvent[]>([]);
  const [pluginConnection, setPluginConnection] = useState<PluginConnection>("disconnected");
  const [pluginVersion, setPluginVersion] = useState("");
  const [pluginHealth, setPluginHealth] = useState({ status: "unknown", dormantCount: 0 });
  const [pluginBackup, setPluginBackup] = useState<PluginSettingsBackup | null>(null);
  const [livePluginBackup, setLivePluginBackup] = useState<PluginSettingsBackup | null>(null);
  const [storedAlerts, setStoredAlerts] = useState<Record<string, AlertConfig>>({});
  const [channelsEnabled, setChannelsEnabled] = useState(false);
  const [queueStatus, setQueueStatus] = useState<Record<string, { position: number; total: number }>>({});
  const [visibleExchanges, setVisibleExchanges] = useState<Exchange[]>([...EXCHANGES]);
  const [mobileVisibleExchanges, setMobileVisibleExchanges] = useState<Exchange[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [rowOrder, setRowOrder] = useState<string[]>(DEFAULT_COINS);
  const [columnOrder, setColumnOrder] = useState<ColumnBlock[]>([...DEFAULT_COLUMN_ORDER]);
  const [marketMeta, setMarketMeta] = useState<Record<string, MarketMetaDisplay>>({});
  const [columnMenu, setColumnMenu] = useState(false);
  const [depthMenu, setDepthMenu] = useState(false);
  const [soundPreviewOpen, setSoundPreviewOpen] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [clock, setClock] = useState(0);
  const [isLeader, setIsLeader] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [monitorActive,setMonitorActive]=useState(false);
  useEffect(()=>{const update=()=>{const value=marketRuntime.state();setMonitorActive(value.active);setPageVisible(value.visible);};update();return marketRuntime.subscribe(update);},[]);
  useEffect(()=>{marketRuntime.setMonitorSymbols(symbols.filter(s=>!pausedSymbols.includes(s)));},[symbols,pausedSymbols]);
  const [clockOverlay, setClockOverlay] = useState(INITIAL_CLOCK_OVERLAY_STATE);

  const running = useRef(new Set<string>());
  const rowsRef = useRef(rows), symbolsRef = useRef(symbols), depthRef = useRef(depth), levelsRef = useRef(globalLevels);
  const channelsEnabledRef = useRef(channelsEnabled);
  const leaderRef = useRef(isLeader);
  const pausedRef = useRef(pausedSymbols);
  const savedAlerts = useRef<Record<string, AlertConfig>>({});
  const historyPane = useRef<HTMLDivElement | null>(null), historyLocked = useRef(true);
  const marketBox = useRef<HTMLDivElement | null>(null), marketLoadedAt = useRef(0);
  const marketDirectory = useRef<{ knownExchanges: Set<string>; bySymbol: Map<string, Set<string>> }>({
    knownExchanges: new Set(),
    bySymbol: new Map(),
  });
  const perpetuals = useRef(new Set<string>());
  const schedulerPaused = useRef<string[]>([]);
  const marketMetaRunning = useRef(false);
  const coordinator = useRef<ReturnType<typeof createTabCoordinator> | null>(null);
  const receiveSnapshot = useRef<(symbol: string, payload: DepthResponse) => void>(() => undefined);
  const receiveMarketMeta = useRef<(payload: MarketMetaBatchResponse) => void>(() => undefined);
  const alertRuntime = useRef<ReturnType<typeof createAlertRuntime> | null>(null);
  const soundPlayer = useRef<AlertSoundPlayer | null>(null);
  const pluginBackupRef = useRef<PluginSettingsBackup | null>(null);
  const pluginRevisionRef = useRef(-1);
  const ensureSoundPlayer = useCallback(() => {
    if (!soundPlayer.current) soundPlayer.current = createBrowserAlertSoundPlayer();
    return soundPlayer.current;
  }, []);
  useEffect(() => {
    alertRuntime.current = createAlertRuntime({
      getLevels: () => levelsRef.current,
      isLeader: () => marketRuntime.isLeader() && marketRuntime.state().active,
      channelsEnabled: () => channelsEnabledRef.current,
      onLog: (entry) => {
        setAlertHistory((current) => trimHistory([...current, entry]));
        coordinator.current?.publishAlert(entry);
      },
      playSound: (symbol, events) => marketRuntime.publish({type:'sound',symbol,events,eventId:crypto.randomUUID()}),
      sendNotification: (message) => {
        if (
          typeof Notification !== "undefined"
          && Notification.permission === "granted"
        ) {
          new Notification("聚合現貨深度監控提醒", { body: message });
        }
      },
    });
    return () => {
      alertRuntime.current = null;
      void soundPlayer.current?.destroy();
      soundPlayer.current = null;
    };
  }, [ensureSoundPlayer]);

  useEffect(()=>{const seen=new Set<string>();return marketRuntime.events(m=>{if(m.type!=='sound'||seen.has(m.eventId)||marketRuntime.state().soundOwner!==marketRuntime.state().owner)return;seen.add(m.eventId);if(seen.size>1000)seen.delete(seen.values().next().value!);ensureSoundPlayer().enqueue(m.symbol,m.events);});},[ensureSoundPlayer]);

  const switchDepth = useCallback((nextDepth: DepthOption) => {
    if(depthRef.current !== nextDepth) alertRuntime.current?.resetPolicy();
    depthRef.current = nextDepth;
    setDepth(nextDepth);
    setRows((current) => Object.fromEntries(Object.entries(current).map(([symbol, row]) => {
      if (!row.snapshot) return [symbol, row];
      const selected = selectDepth(row.snapshot, nextDepth);
      return [symbol, { ...row, sources: selected.sources, bids: selected.bids, asks: selected.asks, imbalance: selected.imbalance }];
    })));
  }, []);

  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { symbolsRef.current = symbols; }, [symbols]);
  useEffect(() => {
    levelsRef.current = globalLevels;
    alertRuntime.current?.resetPolicy();
  }, [globalLevels]);
  useEffect(() => { channelsEnabledRef.current = channelsEnabled; }, [channelsEnabled]);
  useEffect(() => { leaderRef.current = isLeader; }, [isLeader]);
  useEffect(()=>{if(!isLeader)return;try{alertRuntime.current?.restore(JSON.parse(localStorage.getItem('unified-alert-state')??'null'));}catch{}},[isLeader]);
  useEffect(() => { pausedRef.current = pausedSymbols; }, [pausedSymbols]);
  useEffect(() => { pluginBackupRef.current = pluginBackup; }, [pluginBackup]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setIsMobile(media.matches);
      setMobileVisibleExchanges([]);
      if (media.matches) setClockOverlay(INITIAL_CLOCK_OVERLAY_STATE);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!clockOverlay.pinned) return;
    const dismissPinnedClock = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setClockOverlay((current) => reduceClockOverlay(current, "dismiss"));
      }
    };
    document.addEventListener("keydown", dismissPinnedClock);
    return () => document.removeEventListener("keydown", dismissPinnedClock);
  }, [clockOverlay.pinned]);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      setClock(Date.now());
      setPageVisible(marketRuntime.state().visible);
    }, 0);
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    const visibility = () => setPageVisible(marketRuntime.state().visible);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  const applySavedSettings = useCallback(() => {
    localStorage.removeItem(SHARED_DEPTH_PROFILE_KEY);
    const saved = loadDepthSettings(localStorage, EXCHANGES);
    if (!saved) return;
    setSymbols(saved.symbols);
    switchDepth(saved.depth);
    setAggregateDepthSlots(saved.aggregateDepthSlots);
    setGlobalLevels(old=>JSON.stringify(old)===JSON.stringify(saved.globalLevels)?old:saved.globalLevels);
    setRefreshSeconds(saved.refreshSeconds);
    setGapSeconds(saved.gapSeconds);
    setRefreshDraft(String(saved.refreshSeconds));
    setGapDraft(String(saved.gapSeconds));
    setPausedSymbols(saved.pausedSymbols);
    savedAlerts.current = saved.alerts;
    setStoredAlerts(saved.alerts);
    setRows((current) => Object.fromEntries(Object.entries(current).map(([symbol, row]) => [
      symbol,
      { ...row, alert: saved.alerts[symbol] ?? row.alert },
    ])));
    setAlertHistory(saved.alertHistory);
    alertRuntime.current?.setSequence(saved.alertHistory.length);
    setChannelsEnabled(saved.channelsEnabled);
    setVisibleExchanges(saved.visibleExchanges as Exchange[]);
    setRowOrder(saved.rowOrder);
    setColumnOrder(saved.columnOrder);
  }, [switchDepth]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      applySavedSettings();
      setPluginHistory(readPluginHistory(localStorage));
      const storedBackup = readPluginBackup(localStorage);
      pluginBackupRef.current = storedBackup;
      setPluginBackup(storedBackup);
      setPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [applySavedSettings]);

  const postPluginCommand = useCallback((type: string, revision: number, payload: unknown) => {
    window.postMessage({
      source: PLUGIN_PAGE_SOURCE,
      envelope: createPageEnvelope(type, revision, payload),
    }, location.origin);
  }, []);

  useEffect(() => {
    const announce = () => {
      if(!render)return;
      window.postMessage({
        source: PLUGIN_PAGE_SOURCE,
        envelope: createPluginHelloEnvelope(
          location.origin,
          pluginRevisionRef.current < 0 ? 0 : pluginRevisionRef.current,
        ),
      }, location.origin);
    };
    const receivePluginMessage = (event: MessageEvent) => {
      if(!render)return;
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.source !== PLUGIN_EXTENSION_SOURCE) return;
      const envelope = event.data?.envelope;
      if (envelope?.protocolVersion !== 2) {
        setPluginConnection("incompatible");
        return;
      }
      if (envelope?.type === "bridge-status" && envelope.payload?.status === "disconnected") {
        setPluginConnection("disconnected");
        setLivePluginBackup(null);
        return;
      }
      const snapshot = normalizePluginSnapshot(envelope);
      if (!snapshot) return;
      setPluginConnection("connected");
      setPluginVersion(snapshot.extensionVersion);
      setPluginHealth(snapshot.health);
      setLivePluginBackup(snapshot.settingsBackup);
      if (snapshot.revision !== pluginRevisionRef.current) {
        pluginRevisionRef.current = snapshot.revision;
        setPluginHistory(snapshot.history);
        writePluginHistory(localStorage, snapshot.history);
        historyLocked.current = true;
      }
      const websiteBackup = pluginBackupRef.current;
      if (snapshot.settingsBackup && shouldStorePluginBackup(websiteBackup, snapshot.settingsBackup)) {
        pluginBackupRef.current = snapshot.settingsBackup;
        setPluginBackup(snapshot.settingsBackup);
        writePluginBackup(localStorage, snapshot.settingsBackup);
      }
    };
    window.addEventListener("message", receivePluginMessage);
    announce();
    const heartbeat = window.setInterval(announce, 10_000);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("message", receivePluginMessage);
    };
  }, [postPluginCommand,render]);

  const alertPrefs = useMemo(() => Object.fromEntries(Object.entries(rows).map(([symbol, row]) => [symbol, row.alert])), [rows]);
  useEffect(() => {
    if (!preferencesReady) return;
    saveDepthSettings(localStorage, {
      symbols, depth, aggregateDepthSlots, globalLevels, refreshSeconds, gapSeconds, pausedSymbols,
      visibleExchanges, rowOrder, columnOrder,
      alerts: { ...savedAlerts.current, ...alertPrefs },
      alertHistory, channelsEnabled,
    });
  }, [symbols, depth, aggregateDepthSlots, globalLevels, refreshSeconds, gapSeconds, pausedSymbols, visibleExchanges, rowOrder, columnOrder, alertPrefs, alertHistory, channelsEnabled, preferencesReady]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === SETTINGS_KEY) applySavedSettings();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [applySavedSettings]);

  const displayedAlertHistory = useMemo(
    () => combineDisplayedHistory(alertHistory, pluginHistory),
    [alertHistory, pluginHistory],
  );

  useEffect(() => {
    if (!historyLocked.current || !historyPane.current) return;
    const frame = window.requestAnimationFrame(() => { if (historyPane.current) historyPane.current.scrollTop = historyPane.current.scrollHeight; });
    return () => window.cancelAnimationFrame(frame);
  }, [displayedAlertHistory]);

  const loadMarkets = useCallback(async () => {
    setMarketLoading(true);
    setMarketError("");
    try {
      const payload = await getMarketDirectory() as MarketDirectoryResponse;
      if (!Array.isArray(payload.items) || !payload.items.length) throw new Error(payload.error ?? "市場目錄無可用交易對");
      setMarketOptions(payload.items);
      const knownExchanges = new Set(
        (payload.sources ?? []).filter((source) => source.status !== "error").map((source) => source.exchange),
      );
      marketDirectory.current = {
        knownExchanges,
        bySymbol: new Map(payload.items.map((item) => [
          item.symbol,
          new Set(item.exchanges.filter((exchange) => knownExchanges.has(exchange))),
        ])),
      };
      marketLoadedAt.current = Date.now();
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : "市場目錄載入失敗");
    } finally { setMarketLoading(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadMarkets(), 0);
    const timer = window.setInterval(() => void loadMarkets(), MARKET_REFRESH_MS);
    const focus = () => { if (Date.now() - marketLoadedAt.current >= MARKET_REFRESH_MS) void loadMarkets(); };
    const pointer = (event: MouseEvent) => { if (marketBox.current && !marketBox.current.contains(event.target as Node)) setMarketMenu(false); };
    window.addEventListener("focus", focus);
    document.addEventListener("mousedown", pointer);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("mousedown", pointer); };
  }, [loadMarkets]);

  const appendLog = useCallback((symbol: string, type: AlertLogType, message: string, tone?: AlertLogTone) => {
    alertRuntime.current?.appendLog(symbol, type, message, tone);
  }, []);

  const toggleChannels = useCallback(async () => {
    if (channelsEnabledRef.current) {
      soundPlayer.current?.stopAll();
      setChannelsEnabled(false);
      return;
    }
    setChannelsEnabled(true);
    try { await ensureSoundPlayer().prime(); } catch {
      appendLog("系統", "system", "瀏覽器暫時無法啟用提醒聲音；頁面紀錄與系統通知不受影響。", "system");
    }
    if (typeof Notification === "undefined") {
      appendLog("系統", "system", "此瀏覽器不支援系統通知，聲音提醒仍已開啟。");
      return;
    }
    try {
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (permission !== "granted") appendLog("系統", "system", "瀏覽器未允許系統通知，聲音提醒仍已開啟。");
    } catch {
      appendLog("系統", "system", "無法取得系統通知權限，聲音提醒仍已開啟。");
    }
  }, [appendLog, ensureSoundPlayer]);

  const applyPayload = useCallback((symbol: string, payload: DepthResponse, runAlerts: boolean) => {
    const existing = rowsRef.current[symbol];
    const alert = existing?.alert ?? savedAlerts.current[symbol] ?? emptyAlert();
    if (!alertRuntime.current?.acceptSnapshot(symbol, payload.generatedAt)) {
      setRows((old) => old[symbol] ? {
        ...old,
        [symbol]: { ...old[symbol], loading: false, completedAt: Date.now() },
      } : old);
      return false;
    }

    const hasBinancePerpetual = payload.binancePerp || perpetuals.current.has(`${symbol}USDT`);
    const snapshot = { ...payload, binancePerp: hasBinancePerpetual };
    const selected = selectDepth(snapshot, depthRef.current);
    const sourceSignature = signatureOf(selected.sources);
    const sourceModeChanged = Boolean(existing?.sourceSignature && existing.sourceSignature !== sourceSignature);
    const completedAt = Date.now();
    setRows((old) => ({
      ...old,
      [symbol]: {
        symbol,
        sources: selected.sources,
        bids: selected.bids,
        asks: selected.asks,
        imbalance: selected.imbalance,
        startedAt: old[symbol]?.startedAt ?? payload.generatedAt,
        completedAt,
        loading: false,
        alert: old[symbol]?.alert ?? alert,
        binancePerp: hasBinancePerpetual,
        sourceSignature,
        generatedAt: payload.generatedAt,
        snapshot,
      },
    }));

    if (!runAlerts || !leaderRef.current) return true;
    selected.sources.forEach((source) => {
      if (source.status !== "error" && source.status !== "delayed") return;
      if (!marketDirectory.current.bySymbol.get(symbol)?.has(source.exchange)) return;
      const message = source.error ?? (source.status === "delayed" ? "等待超過 30 秒，本輪未納入" : "無法取得資料");
      const key = `${symbol}:${source.exchange}:${source.status}:${message}`;
      alertRuntime.current?.recordError(
        symbol,
        key,
        `${source.exchange}：${message}`,
      );
    });
    if (sourceModeChanged) alertRuntime.current?.onSourceModeChange(symbol);
    else {
      alertRuntime.current?.evaluate(
        symbol,
        selected.imbalance,
        selected.success,
        selected.complete,
        alert,
        depthRef.current,
      );
    }
    try{localStorage.setItem('unified-alert-state',JSON.stringify(alertRuntime.current?.checkpoint()));}catch{}
    return true;
  }, []);

  useEffect(() => {
    receiveSnapshot.current = (symbol, payload) => {
      if (!symbolsRef.current.includes(symbol) || pausedRef.current.includes(symbol)) return;
      applyPayload(symbol, payload, leaderRef.current && marketRuntime.state().active && !pausedRef.current.includes(symbol));
    };
  }, [applyPayload]);

  useEffect(()=>{if(!preferencesReady)return;for(const symbol of symbols){const snapshot=marketRuntime.snapshot(symbol);if(snapshot)applyPayload(symbol,snapshot,false);}},[preferencesReady,symbols,applyPayload]);

  const applyMarketMeta = useCallback((payload: MarketMetaBatchResponse) => {
    const now = Date.now();
    setMarketMeta((current) => {
      const next = { ...current };
      for (const symbol of Object.keys(payload.items)) {
        if (!symbolsRef.current.includes(symbol)) continue;
        const resolved = resolveMarketMeta(
          current[symbol] ?? null,
          payload.items[symbol] ?? [],
          now,
          refreshSeconds,
        );
        if (resolved) next[symbol] = resolved;
        else delete next[symbol];
      }
      return next;
    });
  }, [refreshSeconds]);

  useEffect(() => {
    receiveMarketMeta.current = applyMarketMeta;
  }, [applyMarketMeta]);

  useEffect(() => {
    if (!preferencesReady) return;
    const instance = createTabCoordinator({
      onLeaderChange: (leader) => {
        setIsLeader(leader);
        if (!leader) setQueueStatus({});
      },
      onSnapshot: (symbol, payload) => receiveSnapshot.current(symbol, payload),
      onMarketMeta: (payload) => receiveMarketMeta.current(payload),
      onSettings: applySavedSettings,
      onAlert: (value) => {
        const entry = value as Partial<AlertLogEntry>;
        if (typeof entry.id !== "string" || typeof entry.time !== "number" || typeof entry.symbol !== "string"
          || typeof entry.type !== "string" || typeof entry.message !== "string") return;
        setAlertHistory((current) => current.some((item) => item.id === entry.id)
          ? current
          : trimHistory([...current, entry as AlertLogEntry]));
      },
      onClearHistory: () => {
        historyLocked.current = true;
        setAlertHistory([]);
      },
    });
    coordinator.current = instance;
    return () => {
      coordinator.current = null;
      instance.stop();
      setIsLeader(false);
    };
  }, [applySavedSettings, preferencesReady]);

  useEffect(() => {
    if (!isLeader) return;
    let cancelled = false;
    void loadBinancePerpetuals().then((symbolsWithPerpetuals) => {
      if (cancelled) return;
      perpetuals.current = symbolsWithPerpetuals;
      setRows((current) => Object.fromEntries(Object.entries(current).map(([symbol, row]) => {
        const binancePerp = symbolsWithPerpetuals.has(`${symbol}USDT`);
        return [symbol, {
          ...row,
          binancePerp,
          snapshot: row.snapshot ? { ...row.snapshot, binancePerp } : null,
        }];
      })));
    }).catch(() => {
      // K-line fallback order remains available from successful spot sources.
    });
    return () => { cancelled = true; };
  }, [isLeader]);

  const refreshMarketMeta = useCallback(async () => {
    if (!leaderRef.current || marketMetaRunning.current) return;
    const activeSymbols = symbolsRef.current.filter(
      (symbol) => !pausedRef.current.includes(symbol),
    );
    if (!activeSymbols.length) return;
    marketMetaRunning.current = true;
    try {
      let payload: MarketMetaBatchResponse;
      try {
        payload = await loadBrowserMarketMeta(activeSymbols);
      } catch {
        payload = {
          generatedAt: Date.now(),
          items: Object.fromEntries(activeSymbols.map((symbol) => [symbol, []])),
        };
      }

      // loadBrowserMarketMeta 已內建 /api/exchange-proxy 備援
      applyMarketMeta(payload);
      coordinator.current?.publishMarketMeta(payload);
    } finally {
      marketMetaRunning.current = false;
    }
  }, [applyMarketMeta]);

  useEffect(() => {
    if (!preferencesReady || !isLeader || !monitorActive) return;
    const intervalMs = Math.max(
      5_000,
      refreshSeconds * (pageVisible ? 1 : 5) * 1000,
    );
    const initial = window.setTimeout(() => void refreshMarketMeta(), 250);
    const timer = window.setInterval(() => void refreshMarketMeta(), intervalMs);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [
    symbols,
    pausedSymbols,
    refreshSeconds,
    pageVisible,
    isLeader,
    preferencesReady,
    refreshMarketMeta,
    monitorActive,
  ]);

  const refresh = useCallback(async (symbol: string) => {
    if (!leaderRef.current || running.current.has(symbol)) return;
    running.current.add(symbol);
    const startedAt = Date.now();
    const alert = rowsRef.current[symbol]?.alert ?? savedAlerts.current[symbol] ?? emptyAlert();
    setRows((old) => ({ ...old, [symbol]: { ...(old[symbol] ?? blankRow(symbol, alert)), startedAt, loading: true } }));
    try {
      if(CORE_SYMBOLS.has(symbol)) {const cached=marketRuntime.snapshot(symbol);if(cached)applyPayload(symbol,cached,false);return;}
      const directory=marketDirectory.current;
      let payload=await loadBrowserDepth(symbol,{knownExchanges:[...directory.knownExchanges],supportedExchanges:[...(directory.bySymbol.get(symbol)??[])]});
      payload = { ...payload, binancePerp: payload.binancePerp || perpetuals.current.has(`${symbol}USDT`) };
      applyPayload(symbol, payload, true);
      coordinator.current?.publishSnapshot(symbol, payload);
    } catch (error) {
      setRows((old) => ({ ...old, [symbol]: { ...(old[symbol] ?? blankRow(symbol, alert)), loading: false, completedAt: Date.now() } }));
      alertRuntime.current?.resetPolicy(symbol);
      const message = `聚合失敗：${error instanceof Error ? error.message : "未知錯誤"}`;
      const key = `${symbol}:aggregate:${message}`;
      alertRuntime.current?.recordError(symbol, key, message);
    } finally { running.current.delete(symbol); }
  }, [applyPayload]);

  useEffect(() => {
    const resumed = new Set(schedulerPaused.current.filter((symbol) => !pausedSymbols.includes(symbol)));
    schedulerPaused.current = pausedSymbols;
    if (!preferencesReady || !isLeader || !monitorActive) return;
    const scheduler = createUpdateScheduler({
      symbols: () => symbolsRef.current.filter(symbol=>!CORE_SYMBOLS.has(symbol)),
      paused: () => new Set(pausedRef.current),
      isRunning: (symbol) => running.current.has(symbol),
      startedAt: (symbol) => rowsRef.current[symbol]?.startedAt ?? 0,
      resumed,
      refreshSeconds,
      gapSeconds,
      pageVisible,
      refresh,
      onQueue: setQueueStatus,
      compare: symbolCompare,
    });
    void scheduler.run();
    return () => scheduler.stop();
  }, [symbols, pausedSymbols, refreshSeconds, gapSeconds, pageVisible, isLeader, refresh, preferencesReady, monitorActive]);

  const manualRowOrder = useMemo(
    () => normalizeRowOrder(symbols, rowOrder),
    [symbols, rowOrder],
  );
  const displayRows = useMemo(() => manualRowOrder.map((symbol) => rows[symbol] ?? blankRow(symbol)).sort((a, b) => {
    if (sort.key === "symbol") {
      return (
        manualRowOrder.indexOf(a.symbol) - manualRowOrder.indexOf(b.symbol)
      ) * sort.dir;
    }
    const completeA = a.sources.filter((source) => source.status === "ok").length;
    const completeB = b.sources.filter((source) => source.status === "ok").length;
    const sourceValue = (row: CoinRow, key: SortKey) => key.startsWith("exchange:") ? row.sources.find((source) => source.exchange === key.slice(9))?.imbalance ?? null : null;
    const values: Record<BaseSortKey, [number | null, number | null]> = {
      symbol: [null, null], imbalance: [a.imbalance, b.imbalance], bids: [a.bids, b.bids], asks: [a.asks, b.asks],
      total: [a.bids + a.asks, b.bids + b.asks], complete: [completeA, completeB], time: [a.completedAt || null, b.completedAt || null],
    };
    const [left, right] = sort.key.startsWith("exchange:")
      ? [sourceValue(a, sort.key), sourceValue(b, sort.key)]
      : sort.key.startsWith("aggregate:")
        ? [aggregateSortValue(a, sort.key), aggregateSortValue(b, sort.key)]
        : values[sort.key as BaseSortKey];
    if (left === null && right === null) return symbolCompare(a.symbol, b.symbol);
    if (left === null) return 1;
    if (right === null) return -1;
    return (left - right) * sort.dir;
  }), [manualRowOrder, rows, sort]);

  const filteredMarkets = useMemo(() => filterMarketOptions(marketOptions, newCoin, symbols), [marketOptions, newCoin, symbols]);

  const changeSort = (key: SortKey) => setSort((old) => ({ key, dir: old.key === key ? (old.dir === 1 ? -1 : 1) : key === "symbol" ? 1 : -1 }));
  const selectMarket = (symbol: string) => {
    setNewCoin(symbol);
    setSelectedCoin(symbol);
    setMarketMenu(false);
  };
  const addCoin = () => {
    if (selectedCoin && !symbols.includes(selectedCoin) && symbols.length < MAX_SYMBOLS) {
      setSymbols((current) => [...current, selectedCoin].slice(0, MAX_SYMBOLS));
      setRowOrder((current) => normalizeRowOrder(
        [...symbolsRef.current, selectedCoin].slice(0, MAX_SYMBOLS),
        [...current, selectedCoin],
      ));
    }
    setNewCoin("");
    setSelectedCoin(null);
    setMarketMenu(false);
  };
  const handleMarketKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && filteredMarkets.length) {
      event.preventDefault(); setMarketMenu(true); setMarketIndex((index) => Math.min(index + 1, filteredMarkets.length - 1));
    } else if (event.key === "ArrowUp" && filteredMarkets.length) {
      event.preventDefault(); setMarketMenu(true); setMarketIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Escape") {
      setMarketMenu(false);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (marketMenu && filteredMarkets.length) selectMarket(filteredMarkets[Math.max(marketIndex, 0)].symbol);
      else if (selectedCoin) addCoin();
    }
  };
  const updateAlert = (symbol: string, config: AlertConfig) => {
    const previous = rowsRef.current[symbol]?.alert ?? savedAlerts.current[symbol] ?? emptyAlert();
    if (previous.sound && !config.sound) soundPlayer.current?.clearSymbol(symbol);
    alertRuntime.current?.resetPolicy(symbol);
    savedAlerts.current = { ...savedAlerts.current, [symbol]: config };
    setStoredAlerts((current) => ({ ...current, [symbol]: config }));
    setRows((old) => ({
      ...old,
      [symbol]: { ...(old[symbol] ?? blankRow(symbol)), alert: config },
    }));
  };
  const togglePause = (symbol: string) => {
    const paused = pausedRef.current.includes(symbol);
    setPausedSymbols((current) => paused ? current.filter((item) => item !== symbol) : [...current, symbol]);
  };
  const removeCoin = (symbol: string) => {
    setSymbols((items) => items.filter((item) => item !== symbol));
    setRowOrder((items) => items.filter((item) => item !== symbol));
    setPausedSymbols((items) => items.filter((item) => item !== symbol));
    setRows((current) => {
      const next = { ...current };
      delete next[symbol];
      return next;
    });
    alertRuntime.current?.removeSymbol(symbol);
    soundPlayer.current?.clearSymbol(symbol);
    const nextAlerts = { ...savedAlerts.current };
    delete nextAlerts[symbol];
    savedAlerts.current = nextAlerts;
    setStoredAlerts(nextAlerts);
  };
  const commitRefreshSeconds = () => {
    const value = Math.min(3600, Math.max(5, Math.round(Number(refreshDraft) || DEFAULT_REFRESH_SECONDS)));
    setRefreshSeconds(value);
    setRefreshDraft(String(value));
  };
  const commitGapSeconds = () => {
    const value = Math.min(60, Math.max(0, Number(gapDraft) || 0));
    setGapSeconds(value);
    setGapDraft(String(value));
  };
  const effectiveVisibleExchanges = isMobile
    ? mobileVisibleExchanges
    : visibleExchanges;
  const effectiveAggregateDepths = useMemo(
    () => visibleAggregateDepths(aggregateDepthSlots, depth, isMobile),
    [aggregateDepthSlots, depth, isMobile],
  );
  const setEffectiveVisibleExchanges = (exchanges: Exchange[]) => {
    if (isMobile) setMobileVisibleExchanges(exchanges);
    else setVisibleExchanges(exchanges);
  };
  const toggleExchange = (exchange: Exchange) => {
    const update = (current: Exchange[]) => (
      current.includes(exchange)
        ? current.filter((item) => item !== exchange)
        : EXCHANGES.filter((item) => current.includes(item) || item === exchange)
    );
    if (isMobile) setMobileVisibleExchanges(update);
    else setVisibleExchanges(update);
  };
  const moveRow = (symbol: string, before: string) => {
    setSort({ key: "symbol", dir: 1 });
    setRowOrder((current) => moveOrderItem(
      normalizeRowOrder(symbolsRef.current, current),
      symbol,
      before,
    ));
  };
  const moveColumn = (block: ColumnBlock, before: ColumnBlock) => {
    setColumnOrder((current) => moveOrderItem(current, block, before));
  };
  const resetHiddenDepthSort = (changedDepth: DepthOption) => {
    if (parseAggregateSortKey(sort.key)?.depth === changedDepth) {
      setSort({ key: "symbol", dir: 1 });
    }
  };
  const changeDepthSlot = (index: number, nextDepth: DepthOption) => {
    const currentSlot = aggregateDepthSlots[index];
    if (!currentSlot) return "找不到深度槽位";
    if (aggregateDepthSlots.some((slot, slotIndex) => slotIndex !== index && slot.depth === nextDepth)) {
      return "深度不可重複";
    }
    setAggregateDepthSlots((current) => current.map((slot, slotIndex) => (
      slotIndex === index ? { ...slot, depth: nextDepth } : slot
    )));
    resetHiddenDepthSort(currentSlot.depth);
    if (currentSlot.depth === depthRef.current) switchDepth(nextDepth);
    return "";
  };
  const toggleDepthSlot = (index: number) => {
    const slot = aggregateDepthSlots[index];
    if (!slot) return "找不到深度槽位";
    if (slot.enabled && slot.depth === depthRef.current) return "請先指定其他基準深度";
    setAggregateDepthSlots((current) => current.map((item, slotIndex) => (
      slotIndex === index ? { ...item, enabled: !item.enabled } : item
    )));
    if (slot.enabled) resetHiddenDepthSort(slot.depth);
    return "";
  };
  const setPrimaryDepth = (nextDepth: DepthOption) => {
    const slot = aggregateDepthSlots.find((item) => item.depth === nextDepth);
    if (!slot?.enabled || nextDepth === depthRef.current) return;
    switchDepth(nextDepth);
  };
  const handleHistoryScroll = () => {
    const pane = historyPane.current;
    if (pane) historyLocked.current = isLogAtBottom(pane.scrollHeight, pane.scrollTop, pane.clientHeight);
  };
  const clearAlertHistory = () => {
    setAlertHistory([]);
    historyLocked.current = true;
    coordinator.current?.publishClearHistory();
  };
  const clearPluginHistory = () => {
    setPluginHistory([]);
    pluginRevisionRef.current += 1;
    clearPluginMirror(localStorage);
    historyLocked.current = true;
    postPluginCommand("clear-plugin-history", pluginRevisionRef.current, {});
  };
  const restorePluginBackup = () => {
    if (!pluginBackup || pluginConnection !== "connected") return;
    const message = `網站備份日期：${new Date(pluginBackup.updatedAt).toLocaleString("zh-TW")}\n規則數：${pluginBackup.rules.length}\n\n確定要完整取代插件設定嗎？`;
    if (!window.confirm(message)) return;
    postPluginCommand("restore-settings", pluginBackup.revision, pluginBackup);
  };
  const keepLivePluginBackup = () => {
    if (!livePluginBackup) return;
    pluginBackupRef.current = livePluginBackup;
    setPluginBackup(livePluginBackup);
    writePluginBackup(localStorage, livePluginBackup);
  };
  const pluginBackupState = comparePluginBackups(pluginBackup, livePluginBackup);
  const pluginStatusText = pluginConnection === "connected"
    ? `插件已連線${pluginVersion ? ` · v${pluginVersion}` : ""}${pluginHealth.dormantCount ? ` · ${pluginHealth.dormantCount} 條休眠` : ""}`
    : pluginConnection === "incompatible"
      ? "插件版本不相容"
      : "插件未安裝或未連線";
  const pluginBackupText = !pluginBackup
    ? "網站尚無插件設定備份"
    : pluginBackupState === "conflict"
      ? `備份衝突 · v${pluginBackup.revision} · ${pluginBackup.rules.length} 條規則`
      : pluginBackupState === "website-newer"
        ? `網站備份較新 · ${pluginBackup.rules.length} 條規則`
        : `備份 ${new Date(pluginBackup.updatedAt).toLocaleString("zh-TW")} · ${pluginBackup.rules.length} 條規則`;
  const largeClock = clockParts(clock);
  const clockOverlayVisible = isClockOverlayVisible(clockOverlay, isMobile);
  const toggleClockOverlay = () => {
    if (!isMobile) {
      setClockOverlay((current) => reduceClockOverlay(current, "toggle-pin"));
    }
  };
  const handleClockKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isMobile) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleClockOverlay();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setClockOverlay((current) => reduceClockOverlay(current, "dismiss"));
    }
  };

  if(!render)return null;
  return <div className="monitor-page"><main>
    <header className="topbar">
      <div className="monitor-header-left"><div className="brand"><span className="brandmark">DW</span><div><strong>聚合現貨深度監控</strong><small>6 家交易所即時訂單簿</small></div></div>
      </div>
      <time
        className="local-clock"
        dateTime={clock ? new Date(clock).toISOString() : undefined}
        role={isMobile ? undefined : "button"}
        tabIndex={isMobile ? undefined : 0}
        aria-pressed={isMobile ? undefined : clockOverlay.pinned}
        aria-label={isMobile ? undefined : clockOverlay.pinned ? "關閉滿版日期時間" : "鎖定滿版日期時間"}
        onClick={toggleClockOverlay}
        onKeyDown={handleClockKeyDown}
        onMouseEnter={() => {
          if (!isMobile) {
            setClockOverlay((current) => reduceClockOverlay(current, "pointer-enter"));
          }
        }}
        onMouseLeave={() => {
          setClockOverlay((current) => reduceClockOverlay(current, "pointer-leave"));
        }}
      >
        <span className="desktop-clock">{`${formatClock(clock)}`}</span>
        <span className="mobile-clock">{`${formatCompactClock(clock)}`}</span>
      </time>
      <div className="header-actions">
        {navigation}
        <button className={`ghost notification-toggle${channelsEnabled ? " active" : ""}`} onClick={toggleChannels} aria-pressed={channelsEnabled}>{channelsEnabled ? "關閉通知" : "開啟通知"}</button>
        <button className="ghost sound-preview-trigger" onClick={() => setSoundPreviewOpen(true)} title="試聽八種提醒聲音"><span className="sound-preview-desktop">聲音試聽</span><span className="sound-preview-mobile">♪</span></button>
      </div>
    </header>
    {!isMobile && <div
      className={`clock-overlay${clockOverlayVisible ? " active" : ""}`}
      aria-hidden="true"
    >
      <span>{largeClock.date}</span>
      <strong>{largeClock.time}</strong>
    </div>}

    <section className="hero">
      <div className="hero-title">
        <p className="eyebrow">ORDER BOOK DEPTH RATIO</p>
        <h1>聚合現貨深度監控</h1>
        <ScheduleSettingsCard
          refreshDraft={refreshDraft}
          gapDraft={gapDraft}
          setRefreshDraft={setRefreshDraft}
          setGapDraft={setGapDraft}
          commitRefreshSeconds={commitRefreshSeconds}
          commitGapSeconds={commitGapSeconds}
          isLeader={isLeader}
          pageVisible={pageVisible}
          refreshSeconds={refreshSeconds}
        />
      </div>
      <AlertLogPanel
        history={displayedAlertHistory}
        historyPane={historyPane}
        onHistoryScroll={handleHistoryScroll}
        pluginConnection={pluginConnection}
        pluginStatusText={pluginStatusText}
        pluginBackupText={pluginBackupText}
        canClearWebsiteHistory={alertHistory.length > 0}
        canClearPluginHistory={pluginHistory.length > 0}
        canRestorePluginBackup={pluginBackup !== null}
        canKeepLivePluginBackup={livePluginBackup !== null && pluginBackupState !== "same"}
        onClearWebsiteHistory={clearAlertHistory}
        onClearPluginHistory={clearPluginHistory}
        onRestorePluginBackup={restorePluginBackup}
        onKeepLivePluginBackup={keepLivePluginBackup}
        globalLevels={globalLevels}
        setGlobalLevels={setGlobalLevels}
      />
    </section>

    <section className="table-card">
      <MonitorToolbar
        aggregateDepthSlots={aggregateDepthSlots}
        primaryDepth={depth}
        depthMenu={depthMenu}
        toggleDepthMenu={() => setDepthMenu((open) => !open)}
        onChangeDepthSlot={changeDepthSlot}
        onToggleDepthSlot={toggleDepthSlot}
        onSetPrimaryDepth={setPrimaryDepth}
        marketBox={marketBox}
        newCoin={newCoin}
        symbols={symbols}
        marketLoading={marketLoading}
        marketOptions={marketOptions}
        marketError={marketError}
        marketMenu={marketMenu}
        marketIndex={marketIndex}
        selectedCoin={selectedCoin}
        filteredMarkets={filteredMarkets}
        onMarketFocus={() => {
          if (marketError && !marketOptions.length) void loadMarkets();
          if (newCoin.trim()) setMarketMenu(true);
        }}
        onMarketChange={(input) => {
          const value = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
          setNewCoin(value);
          setSelectedCoin(null);
          setMarketIndex(-1);
          setMarketMenu(Boolean(value));
        }}
        onMarketKeyDown={handleMarketKeyDown}
        addCoin={addCoin}
        selectMarket={selectMarket}
        setMarketIndex={setMarketIndex}
        columnMenu={columnMenu}
        toggleColumnMenu={() => setColumnMenu((open) => !open)}
        visibleExchanges={effectiveVisibleExchanges}
        setVisibleExchanges={setEffectiveVisibleExchanges}
        toggleExchange={toggleExchange}
      />
      <DepthTable
        rows={displayRows}
        visibleExchanges={effectiveVisibleExchanges}
        aggregateDepths={effectiveAggregateDepths}
        primaryDepth={depth}
        columnOrder={columnOrder}
        marketMeta={marketMeta}
        isMobile={isMobile}
        globalLevels={globalLevels}
        expanded={expanded}
        queueStatus={queueStatus}
        pausedSymbols={pausedSymbols}
        clock={clock}
        isLeader={isLeader}
        onSort={changeSort}
        onToggleExpanded={(symbol) => {
          setExpanded(expanded === symbol ? null : symbol);
        }}
        onTogglePause={togglePause}
        onOpenSettings={setSettings}
        onRemove={removeCoin}
        onMoveRow={moveRow}
        onMoveColumn={moveColumn}
      />
    </section>

    <footer><span>聚合現貨深度監控僅供市場觀察，不構成投資建議。</span><span>USD 與美元穩定幣以 1:1 計價 · 部分深度仍納入統計</span></footer>

    {settings && <CoinAlertDialog
      key={settings}
      symbol={settings}
      config={rows[settings]?.alert ?? storedAlerts[settings] ?? emptyAlert()}
      onSave={(symbol, config) => { updateAlert(symbol, config); setSettings(null); }}
      onClose={() => setSettings(null)}
    />}
    {soundPreviewOpen && <SoundPreviewDialog
      onPreview={(event: AlertEvent) => ensureSoundPlayer().preview(event)}
      onClose={() => setSoundPreviewOpen(false)}
    />}
  </main></div>;
}
