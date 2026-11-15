export const BROWSER_EXCHANGES = [
  "Binance",
  "OKX",
  "Bybit",
  "Coinbase",
  "Bitfinex",
  "Kraken",
] as const;

export type BrowserExchange = typeof BROWSER_EXCHANGES[number];
export type BrowserDepthLoader<T = unknown> = (
  symbol: string,
  binanceLimit: number,
  signal: AbortSignal,
) => Promise<T>;
export type BrowserDepthAdapter<T = unknown> = {
  exchange: BrowserExchange;
  load: BrowserDepthLoader<T>;
};

export function createBrowserAdapterRegistry<T = unknown>(
  loaders: Record<BrowserExchange, BrowserDepthLoader<T>>,
) {
  return new Map<BrowserExchange, BrowserDepthAdapter<T>>(
    BROWSER_EXCHANGES.map((exchange) => [
      exchange,
      { exchange, load: loaders[exchange] },
    ]),
  );
}
