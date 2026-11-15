export const AXIS_MAX = 0.7;
export const ALERT_HISTORY_LIMIT = 200;
export const LOG_BOTTOM_TOLERANCE = 16;

export type ClockOverlayState = {
  hovered: boolean;
  pinned: boolean;
};

export type ClockOverlayAction =
  | "pointer-enter"
  | "pointer-leave"
  | "toggle-pin"
  | "dismiss";

export const INITIAL_CLOCK_OVERLAY_STATE: ClockOverlayState = {
  hovered: false,
  pinned: false,
};

export function reduceClockOverlay(
  state: ClockOverlayState,
  action: ClockOverlayAction,
): ClockOverlayState {
  if (action === "pointer-enter") return { ...state, hovered: true };
  if (action === "pointer-leave") return { ...state, hovered: false };
  if (action === "dismiss") return INITIAL_CLOCK_OVERLAY_STATE;
  if (state.pinned) return INITIAL_CLOCK_OVERLAY_STATE;
  return { ...state, pinned: true };
}

export function isClockOverlayVisible(state: ClockOverlayState, isMobile: boolean) {
  return !isMobile && (state.hovered || state.pinned);
}

export function axisPosition(value: number) {
  const clamped = Math.max(-AXIS_MAX, Math.min(AXIS_MAX, value));
  return (clamped + AXIS_MAX) / (AXIS_MAX * 2) * 100;
}

export function trimHistory<T>(entries: T[]) {
  return entries.slice(-ALERT_HISTORY_LIMIT);
}

export function isLogAtBottom(scrollHeight: number, scrollTop: number, clientHeight: number) {
  return scrollHeight - scrollTop - clientHeight <= LOG_BOTTOM_TOLERANCE;
}

export type SearchableMarket = { symbol: string; sourceCount: number; exchanges: string[] };

export type CoinGlassChartSource = {
  exchange: string;
  pair: string;
  status: string;
  bids: number;
  asks: number;
};

export type CoinGlassChart = { exchange: string; pair: string; href: string };

export function selectCoinGlassChart(
  symbol: string,
  binancePerp: boolean,
  sources: CoinGlassChartSource[],
  exchangeOrder: readonly string[],
): CoinGlassChart | null {
  let exchange = "Binance";
  let pair = `${symbol}USDT`;

  if (!binancePerp) {
    const source = exchangeOrder
      .filter((item) => item !== "Binance")
      .map((item) => sources.find((candidate) => candidate.exchange === item))
      .find((candidate) => candidate && (candidate.status === "ok" || candidate.status === "partial") && candidate.bids + candidate.asks > 0);
    if (!source) return null;
    exchange = source.exchange;
    pair = source.pair;
  }

  const normalizedPair = pair.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalizedPair) return null;
  return {
    exchange,
    pair: normalizedPair,
    href: `https://www.coinglass.com/tv/zh-TW/${exchange}_${normalizedPair}`,
  };
}

export function filterMarketOptions(items: SearchableMarket[], query: string, excluded: Iterable<string>) {
  const needle = query.trim().toUpperCase();
  if (!needle) return [];
  const blocked = new Set(excluded);
  return items
    .filter((item) => !blocked.has(item.symbol) && item.symbol.includes(needle))
    .sort((a, b) => {
      const prefix = Number(b.symbol.startsWith(needle)) - Number(a.symbol.startsWith(needle));
      return prefix || a.symbol.localeCompare(b.symbol);
    });
}
