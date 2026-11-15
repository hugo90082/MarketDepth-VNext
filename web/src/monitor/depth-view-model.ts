import { emptyAlert, type AlertConfig, type DirectionalLevels, type Levels } from "./depth-settings.ts";
import type { DepthResponse, SourceResult } from "./depth-types.ts";

export const EXCHANGES = [
  "Binance",
  "OKX",
  "Bybit",
  "Coinbase",
  "Bitfinex",
  "Kraken",
] as const;

export type Exchange = typeof EXCHANGES[number];
export type CoinRow = {
  symbol: string;
  sources: SourceResult[];
  bids: number;
  asks: number;
  imbalance: number | null;
  startedAt: number;
  completedAt: number;
  loading: boolean;
  alert: AlertConfig;
  binancePerp: boolean;
  sourceSignature: string;
  generatedAt: number;
  snapshot: DepthResponse | null;
};
export type BaseSortKey =
  | "symbol"
  | "imbalance"
  | "bids"
  | "asks"
  | "total"
  | "complete"
  | "time";
export type SortKey = BaseSortKey | `exchange:${Exchange}` | `aggregate:${number}:${"imbalance" | "bids" | "asks" | "total" | "complete"}`;
export type Strength = { text: string; cls: string };

const PRIORITY: Record<string, number> = {
  BTC: 0,
  ETH: 1,
  SOL: 2,
};

export function blankRow(symbol: string, alert = emptyAlert()): CoinRow {
  return {
    symbol,
    sources: [],
    bids: 0,
    asks: 0,
    imbalance: null,
    startedAt: 0,
    completedAt: 0,
    loading: true,
    alert,
    binancePerp: false,
    sourceSignature: "",
    generatedAt: 0,
    snapshot: null,
  };
}

export function symbolCompare(left: string, right: string) {
  const rankA = PRIORITY[left] ?? 999;
  const rankB = PRIORITY[right] ?? 999;
  return rankA !== rankB ? rankA - rankB : left.localeCompare(right);
}

export function statusLabel(
  value: number | null,
  levels: Levels | DirectionalLevels,
): Strength {
  const buy = "buy" in levels ? levels.buy : levels;
  const sell = "sell" in levels ? levels.sell : levels;
  if (value === null) return { text: "等待資料", cls: "neutral" };
  if (value >= buy.level3) return { text: "極端買盤 III", cls: "buy3" };
  if (value >= buy.level2) return { text: "極端買盤 II", cls: "buy2" };
  if (value >= buy.level1) return { text: "極端買盤 I", cls: "buy1" };
  if (value > 0) return { text: "買盤偏強", cls: "buy" };
  if (value <= -sell.level3) return { text: "極端賣盤 III", cls: "sell3" };
  if (value <= -sell.level2) return { text: "極端賣盤 II", cls: "sell2" };
  if (value <= -sell.level1) return { text: "極端賣盤 I", cls: "sell1" };
  if (value < 0) return { text: "賣盤偏強", cls: "sell" };
  return { text: "買賣平衡", cls: "neutral" };
}

export function ratio(value: number | null) {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

export function money(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-TW", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatTime(value: number) {
  return value
    ? new Date(value).toLocaleTimeString("zh-TW", { hour12: false })
    : "—";
}

export function formatBucket(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 8,
  }).format(value);
}

export function acquisitionModeLabel(source: SourceResult) {
  if (source.acquisitionMode === "web-feed") return "交易頁公開資料流";
  if (source.acquisitionMode === "cloud-fallback") return "同站雲端備援";
  return "瀏覽器官方 API";
}
