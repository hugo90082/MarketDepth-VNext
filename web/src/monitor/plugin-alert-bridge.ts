import type { AlertLogEntry } from "./depth-settings.ts";
import {
  normalizeDepthProfile,
  type SharedDepthThresholdProfile,
} from "./shared-depth-profile.ts";

export const PLUGIN_PROTOCOL_VERSION = 2;
export const PLUGIN_HISTORY_KEY = "depthwatch-plugin-alert-history-v1";
export const PLUGIN_BACKUP_KEY = "depthwatch-plugin-settings-backup-v1";
export const PLUGIN_PAGE_SOURCE = "depthwatch-plugin-page-v1";
export const PLUGIN_EXTENSION_SOURCE = "coinglass-indicator-extension-v1";

export const RULE_KINDS = [
  "above",
  "below",
  "cross-up",
  "cross-down",
  "buy1",
  "buy2",
  "buy3",
  "sell1",
  "sell2",
  "sell3",
  "direction-buy",
  "direction-sell",
] as const;

export type PluginRuleKind = typeof RULE_KINDS[number];
export type PluginConnection = "connected" | "disconnected" | "incompatible";
export type PluginBridgeCapabilities = {
  independentThresholds: boolean;
};
export const PLUGIN_BRIDGE_CAPABILITIES = Object.freeze({
  independentThresholds: true,
});

export type ExtensionAlertEvent = {
  id: string;
  source: "coinglass-indicator-extension";
  time: number;
  ruleId: string;
  ruleName?: string;
  symbol: string;
  exchange: string;
  interval: string;
  indicator: string;
  indicatorLabel?: string;
  output: string;
  displayValue: string;
  normalizedValue: number;
  ruleKind: PluginRuleKind;
  mode: "depth-ratio" | "generic";
  depthLabel?: number;
  tone: string;
  message: string;
};

export type PluginSettingsBackup = {
  schemaVersion: 2;
  revision: number;
  updatedAt: number;
  checksum: string;
  rules: unknown[];
  preferences: Record<string, unknown>;
  pinnedPage: Record<string, unknown> | null;
  depthProfile: SharedDepthThresholdProfile;
  pendingRuleTemplates?: unknown[];
};

export type PluginSnapshot = {
  revision: number;
  connection: "connected";
  extensionVersion: string;
  history: ExtensionAlertEvent[];
  settingsBackup: PluginSettingsBackup | null;
  capabilities: PluginBridgeCapabilities;
  health: { status: string; dormantCount: number };
};

export type BridgeEnvelope<T = unknown> = {
  protocolVersion: 2;
  type: string;
  revision: number;
  payload: T;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string"
    && value.length <= max
    && (allowEmpty || value.length > 0);
}

function finiteTimestamp(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value < 100_000_000_000_000;
}

const DEPTH_LABELS = [0.25, 0.5, 0.75, 1, 2, 3, 5, 10];
const DEPTH_KINDS = new Set(["buy1", "buy2", "buy3", "sell1", "sell2", "sell3", "direction-buy", "direction-sell"]);
const GENERIC_KINDS = new Set(["above", "below", "cross-up", "cross-down"]);

export function normalizePluginEvent(value: unknown): ExtensionAlertEvent | null {
  if (!isRecord(value)) return null;
  if (
    value.source !== "coinglass-indicator-extension"
    || !boundedText(value.id, 160)
    || !finiteTimestamp(value.time)
    || !boundedText(value.ruleId, 160)
    || (value.ruleName !== undefined && !boundedText(value.ruleName, 160, true))
    || !boundedText(value.symbol, 30)
    || !/^[A-Z0-9]{1,30}$/.test(value.symbol)
    || !boundedText(value.exchange, 80)
    || !boundedText(value.interval, 30)
    || !boundedText(value.indicator, 240)
    || (value.indicatorLabel !== undefined && !boundedText(value.indicatorLabel, 160))
    || !boundedText(value.output, 160)
    || !boundedText(value.displayValue, 80, true)
    || typeof value.normalizedValue !== "number"
    || !Number.isFinite(value.normalizedValue)
    || !RULE_KINDS.includes(value.ruleKind as PluginRuleKind)
    || !(value.mode === "depth-ratio" || value.mode === "generic")
    || typeof value.tone !== "string"
    || value.tone.length > 40
    || !boundedText(value.message, 800)
  ) return null;
  if (value.mode === "depth-ratio" && (!DEPTH_KINDS.has(String(value.ruleKind)) || !DEPTH_LABELS.includes(Number(value.depthLabel)))) return null;
  if (value.mode === "generic" && !GENERIC_KINDS.has(String(value.ruleKind))) return null;
  return value as ExtensionAlertEvent;
}

export function normalizePluginBackup(value: unknown): PluginSettingsBackup | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 2
    || !Number.isInteger(value.revision)
    || Number(value.revision) < 0
    || !finiteTimestamp(value.updatedAt)
    || !boundedText(value.checksum, 128)
    || !Array.isArray(value.rules)
    || value.rules.length > 200
    || !isRecord(value.preferences)
    || !(value.pinnedPage === null || isRecord(value.pinnedPage))
  ) return null;
  const depthProfile = normalizeDepthProfile(value.depthProfile);
  if (!depthProfile) return null;
  try {
    if (JSON.stringify(value).length > 1_000_000) return null;
  } catch {
    return null;
  }
  return { ...value, depthProfile } as PluginSettingsBackup;
}

export function normalizePluginSnapshot(value: unknown): PluginSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    value.protocolVersion !== PLUGIN_PROTOCOL_VERSION
    || value.type !== "plugin-snapshot"
    || !Number.isInteger(value.revision)
    || Number(value.revision) < 0
    || !isRecord(value.payload)
  ) return null;
  const payload = value.payload;
  if (
    payload.connection !== "connected"
    || !boundedText(payload.extensionVersion, 40)
    || !Array.isArray(payload.history)
    || payload.history.length > 200
  ) return null;
  const history = payload.history.map(normalizePluginEvent);
  if (history.some((entry) => entry === null)) return null;
  const backup = payload.settingsBackup === undefined || payload.settingsBackup === null
    ? null
    : normalizePluginBackup(payload.settingsBackup);
  if (payload.settingsBackup && !backup) return null;
  const capabilities = isRecord(payload.capabilities)
    ? {
        independentThresholds: payload.capabilities.independentThresholds === true,
      }
    : { independentThresholds: false };
  const health = isRecord(payload.health)
    && boundedText(payload.health.status, 40)
    && Number.isInteger(payload.health.dormantCount)
    && Number(payload.health.dormantCount) >= 0
    ? { status: payload.health.status, dormantCount: Number(payload.health.dormantCount) }
    : { status: "unknown", dormantCount: 0 };
  return {
    revision: Number(value.revision),
    connection: "connected",
    extensionVersion: payload.extensionVersion,
    history: history as ExtensionAlertEvent[],
    settingsBackup: backup,
    capabilities,
    health,
  };
}

function asWebsiteEntry(event: ExtensionAlertEvent): AlertLogEntry {
  return {
    id: `plugin:${event.id}`,
    source: "coinglass-indicator-extension",
    externalId: event.id,
    time: event.time,
    symbol: event.symbol,
    type: "plugin",
    message: event.message,
    tone: event.tone as AlertLogEntry["tone"],
    depthLabel: event.depthLabel,
    displayValue: event.displayValue,
    pluginEvent: event,
  };
}

export function combineDisplayedHistory(
  nativeHistory: AlertLogEntry[],
  pluginHistory: ExtensionAlertEvent[],
  limit = 200,
): AlertLogEntry[] {
  const combined = new Map<string, AlertLogEntry>();
  for (const entry of nativeHistory) {
    if (!entry || typeof entry.id !== "string" || !finiteTimestamp(entry.time)) continue;
    const source = entry.source ?? "depthwatch";
    combined.set(`${source}:${entry.id}`, { ...entry, source });
  }
  for (const event of pluginHistory) {
    const entry = asWebsiteEntry(event);
    combined.set(`${event.source}:${event.id}`, entry);
  }
  return [...combined.values()]
    .sort((left, right) => left.time - right.time)
    .slice(-Math.max(0, limit));
}

function normalizedHistory(value: unknown): ExtensionAlertEvent[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, ExtensionAlertEvent>();
  for (const candidate of value.slice(-400)) {
    const event = normalizePluginEvent(candidate);
    if (event) byId.set(`${event.source}:${event.id}`, event);
  }
  return [...byId.values()].sort((left, right) => left.time - right.time).slice(-200);
}

export function readPluginHistory(storage: Pick<Storage, "getItem">): ExtensionAlertEvent[] {
  try {
    return normalizedHistory(JSON.parse(storage.getItem(PLUGIN_HISTORY_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function writePluginHistory(storage: Pick<Storage, "setItem">, history: ExtensionAlertEvent[]) {
  storage.setItem(PLUGIN_HISTORY_KEY, JSON.stringify(normalizedHistory(history)));
}

export function readPluginBackup(storage: Pick<Storage, "getItem">): PluginSettingsBackup | null {
  try {
    return normalizePluginBackup(JSON.parse(storage.getItem(PLUGIN_BACKUP_KEY) ?? "null"));
  } catch {
    return null;
  }
}

export function writePluginBackup(storage: Pick<Storage, "setItem">, backup: PluginSettingsBackup) {
  const normalized = normalizePluginBackup(backup);
  if (normalized) storage.setItem(PLUGIN_BACKUP_KEY, JSON.stringify(normalized));
}

export function comparePluginBackups(
  website: PluginSettingsBackup | null,
  plugin: PluginSettingsBackup | null,
): "empty" | "same" | "website-newer" | "plugin-newer" | "conflict" {
  if (!website && !plugin) return "empty";
  if (website && !plugin) return "website-newer";
  if (!website && plugin) return "plugin-newer";
  if (!website || !plugin) return "empty";
  if (website.checksum === plugin.checksum) return "same";
  if (website.revision !== plugin.revision) {
    return website.revision > plugin.revision ? "website-newer" : "plugin-newer";
  }
  if (website.updatedAt !== plugin.updatedAt) {
    return website.updatedAt > plugin.updatedAt ? "website-newer" : "plugin-newer";
  }
  return "conflict";
}

export function shouldStorePluginBackup(
  website: PluginSettingsBackup | null,
  plugin: PluginSettingsBackup | null,
): boolean {
  if (!plugin) return false;
  const state = comparePluginBackups(website, plugin);
  return state === "empty" || state === "plugin-newer";
}

export function clearPluginMirror(storage: StorageLike) {
  storage.removeItem(PLUGIN_HISTORY_KEY);
}

export function createPageEnvelope<T>(type: string, revision: number, payload: T): BridgeEnvelope<T> {
  return {
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    type: type.slice(0, 64),
    revision: Math.max(0, Math.trunc(revision)),
    payload,
  };
}

export function createPluginHelloEnvelope(origin: string, revision: number) {
  return createPageEnvelope("hello", revision, {
    origin: origin.slice(0, 2_000),
    capabilities: PLUGIN_BRIDGE_CAPABILITIES,
  });
}
