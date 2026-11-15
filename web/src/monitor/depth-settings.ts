import type { AlertEvent } from "./alert-policy.ts";
import { trimHistory } from "./depth-ui.ts";
import { DEPTH_OPTIONS, isDepthOption, type DepthOption } from "./depth-types.ts";
import {
  DEFAULT_COLUMN_ORDER,
  normalizeColumnOrder,
  normalizeRowOrder,
  type ColumnBlock,
} from "./table-layout.ts";

export type Levels = {
  level1: number;
  level2: number;
  level3: number;
};

export type DirectionalLevels = {
  buy: Levels;
  sell: Levels;
};

export type AggregateDepthSlot = {
  depth: DepthOption;
  enabled: boolean;
};

export type AlertConfig = {
  enabled: boolean;
  custom: boolean;
  level1: number;
  level2: number;
  level3: number;
  splitSides: boolean;
  buyLevels: Levels;
  sellLevels: Levels;
  sound: boolean;
  notification: boolean;
};

import type { ExtensionAlertEvent } from "./plugin-alert-bridge.ts";

export type AlertLogType = "threshold" | "direction" | "error" | "system" | "plugin";
export type AlertLogTone = AlertEvent | "generic-up" | "generic-down" | "error" | "system";
export type AlertLogEntry = {
  id: string;
  source?: "depthwatch" | "coinglass-indicator-extension";
  externalId?: string;
  time: number;
  symbol: string;
  type: AlertLogType;
  message: string;
  tone?: AlertLogTone;
  depthLabel?: number;
  displayValue?: string;
  pluginEvent?: ExtensionAlertEvent;
};

export const DEFAULT_COINS = ["BTC", "ETH", "SOL"];
export const DEFAULT_REFRESH_SECONDS = 30;
export const DEFAULT_GAP_SECONDS = 1;
export const DEFAULT_LEVELS: Levels = {
  level1: 0.2,
  level2: 0.3,
  level3: 0.4,
};
export const SETTINGS_VERSION = 9;
const STRENGTH_FIRST_SETTINGS_VERSION = 8;
export const SETTINGS_KEY = "depthwatch-settings";
export const MAX_SYMBOLS = 20;

export type DepthSettings = {
  symbols: string[];
  depth: DepthOption;
  aggregateDepthSlots: AggregateDepthSlot[];
  globalLevels: Levels;
  refreshSeconds: number;
  gapSeconds: number;
  pausedSymbols: string[];
  visibleExchanges: string[];
  rowOrder: string[];
  columnOrder: ColumnBlock[];
  alerts: Record<string, AlertConfig>;
  alertHistory: AlertLogEntry[];
  channelsEnabled: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function emptyAlert(): AlertConfig {
  return {
    enabled: true,
    custom: false,
    ...DEFAULT_LEVELS,
    splitSides: false,
    buyLevels: { ...DEFAULT_LEVELS },
    sellLevels: { ...DEFAULT_LEVELS },
    sound: true,
    notification: true,
  };
}

const DEPTH_SLOT_SEEDS = [0.25, 1, 2, 3, 5, 10] as const;

export function createDepthSlots(primary: DepthOption): AggregateDepthSlot[] {
  return [primary, ...DEPTH_SLOT_SEEDS.filter((depth) => depth !== primary)]
    .slice(0, 5)
    .map((depth, index) => ({ depth, enabled: index === 0 }));
}

export function normalizeDepthSlots(
  candidate: unknown,
  primary: DepthOption,
): AggregateDepthSlot[] {
  const seen = new Set<number>();
  const normalized = Array.isArray(candidate)
    ? candidate.flatMap((value): AggregateDepthSlot[] => {
      if (!value || typeof value !== "object") return [];
      const item = value as Partial<AggregateDepthSlot>;
      const depth = Number(item.depth);
      if (!isDepthOption(depth) || seen.has(depth)) return [];
      seen.add(depth);
      return [{ depth, enabled: item.enabled === true }];
    })
    : [];

  const primaryIndex = normalized.findIndex((slot) => slot.depth === primary);
  if (primaryIndex >= 0) normalized[primaryIndex] = { ...normalized[primaryIndex], enabled: true };
  else normalized.unshift({ depth: primary, enabled: true });

  const fillValues = [...DEPTH_SLOT_SEEDS, ...DEPTH_OPTIONS];
  for (const depth of fillValues) {
    if (normalized.length >= 5) break;
    if (seen.has(depth) || depth === primary) continue;
    seen.add(depth);
    normalized.push({ depth, enabled: false });
  }
  return normalized.slice(0, 5);
}

export function normalizeLevels(value: Partial<Levels> | undefined): Levels {
  if (
    typeof value?.level1 === "number"
    && typeof value?.level2 === "number"
    && typeof value?.level3 === "number"
    && value.level1 > 0
    && value.level1 < value.level2
    && value.level2 < value.level3
    && value.level3 <= 0.7
  ) {
    return {
      level1: value.level1,
      level2: value.level2,
      level3: value.level3,
    };
  }
  return { ...DEFAULT_LEVELS };
}

export function normalizeAlert(
  value: Partial<AlertConfig> | undefined,
): AlertConfig {
  const fallback = emptyAlert();
  const shared = normalizeLevels(value);
  return {
    enabled: typeof value?.enabled === "boolean"
      ? value.enabled
      : fallback.enabled,
    custom: typeof value?.custom === "boolean"
      ? value.custom
      : fallback.custom,
    ...shared,
    splitSides: value?.splitSides === true,
    buyLevels: normalizeLevels(value?.buyLevels ?? shared),
    sellLevels: normalizeLevels(value?.sellLevels ?? shared),
    sound: typeof value?.sound === "boolean" ? value.sound : fallback.sound,
    notification: typeof value?.notification === "boolean"
      ? value.notification
      : fallback.notification,
  };
}

export function resolveAlertLevels(
  config: AlertConfig,
  globalLevels: Levels,
): DirectionalLevels {
  if (!config.custom) {
    return { buy: globalLevels, sell: globalLevels };
  }
  if (!config.splitSides) {
    const shared = { level1: config.level1, level2: config.level2, level3: config.level3 };
    return { buy: shared, sell: shared };
  }
  return { buy: config.buyLevels, sell: config.sellLevels };
}

export function loadDepthSettings(
  storage: StorageLike,
  allowedExchanges: readonly string[],
): DepthSettings | null {
  try {
    const saved = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return null;

    const rawSymbols = Array.isArray(saved.symbols)
      ? saved.symbols.filter((item: unknown): item is string => typeof item === "string")
      : DEFAULT_COINS;
    const legacyDefault = rawSymbols.join(",") === "BTC,ETH,SOL,XRP,DOGE";
    const symbols = (legacyDefault ? DEFAULT_COINS : rawSymbols).slice(
      0,
      MAX_SYMBOLS,
    );
    const savedDepth = Number(saved.depth);
    const depth = isDepthOption(savedDepth) ? savedDepth : 10;
    const settingsVersion = Number(saved.settingsVersion) || 0;
    const refreshSeconds = Math.min(
      3600,
      Math.max(5, Number(saved.refreshSeconds) || DEFAULT_REFRESH_SECONDS),
    );
    const savedGap = Math.min(
      60,
      Math.max(0, Number(saved.gapSeconds) || 0),
    );
    const alerts = saved.alerts && typeof saved.alerts === "object"
      ? Object.fromEntries(
        Object.entries(saved.alerts).map(([symbol, value]) => [
          symbol,
          normalizeAlert(value as Partial<AlertConfig>),
        ]),
      )
      : {};
    if (
      settingsVersion < SETTINGS_VERSION
      && saved.nativeAlerts && typeof saved.nativeAlerts === "object"
      && saved.pluginRuleImports && typeof saved.pluginRuleImports === "object"
    ) {
      for (const [symbol, markerValue] of Object.entries(saved.pluginRuleImports)) {
        if (!markerValue || typeof markerValue !== "object") continue;
        const marker = markerValue as Record<string, unknown>;
        if (
          typeof marker.ruleId !== "string"
          || typeof marker.fingerprint !== "string"
          || !isDepthOption(Number(marker.depth))
        ) continue;
        const native = saved.nativeAlerts[symbol];
        if (native && typeof native === "object") {
          alerts[symbol] = normalizeAlert(native as Partial<AlertConfig>);
        }
      }
    }
    const history = Array.isArray(saved.alertHistory)
      ? saved.alertHistory.filter(
        (entry: Partial<AlertLogEntry>) => entry
          && typeof entry.id === "string"
          && typeof entry.time === "number"
          && typeof entry.message === "string",
      )
      : [];

    const normalizedColumns = normalizeColumnOrder(
      Array.isArray(saved.columnOrder)
        ? saved.columnOrder.filter(
          (item: unknown): item is string => typeof item === "string",
        )
        : DEFAULT_COLUMN_ORDER,
    );
    const columnOrder = settingsVersion < STRENGTH_FIRST_SETTINGS_VERSION
      ? ["strength", ...normalizedColumns.filter((item) => item !== "strength")] as ColumnBlock[]
      : normalizedColumns;

    return {
      symbols,
      depth,
      aggregateDepthSlots: normalizeDepthSlots(saved.aggregateDepthSlots, depth),
      globalLevels: settingsVersion < SETTINGS_VERSION
        ? { ...DEFAULT_LEVELS }
        : normalizeLevels(saved.globalLevels),
      refreshSeconds,
      gapSeconds: saved.gapSeconds === undefined
        ? DEFAULT_GAP_SECONDS
        : savedGap,
      pausedSymbols: Array.isArray(saved.pausedSymbols)
        ? saved.pausedSymbols.filter(
          (item: unknown): item is string => typeof item === "string"
            && symbols.includes(item),
        )
        : [],
      visibleExchanges: Array.isArray(saved.visibleExchanges)
        ? saved.visibleExchanges.filter(
          (item: unknown): item is string => typeof item === "string"
            && allowedExchanges.includes(item),
        )
        : [...allowedExchanges],
      rowOrder: normalizeRowOrder(
        symbols,
        Array.isArray(saved.rowOrder)
          ? saved.rowOrder.filter(
            (item: unknown): item is string => typeof item === "string",
          )
          : undefined,
      ),
      columnOrder,
      alerts,
      alertHistory: trimHistory(history as AlertLogEntry[]),
      channelsEnabled: typeof saved.channelsEnabled === "boolean"
        ? saved.channelsEnabled
        : false,
    };
  } catch {
    return null;
  }
}

export function saveDepthSettings(
  storage: StorageLike,
  settings: DepthSettings,
) {
  storage.setItem(SETTINGS_KEY, JSON.stringify({
    settingsVersion: SETTINGS_VERSION,
    ...settings,
  }));
}
