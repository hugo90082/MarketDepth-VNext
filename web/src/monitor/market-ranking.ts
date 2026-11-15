/* eslint-disable @typescript-eslint/no-explicit-any */
// An explicit list prevents non-dollar fiat, gold and similarly named assets from entering the aggregate.
export const USD_QUOTES = [
  "USD", "USDT", "USDC", "FDUSD", "TUSD", "BUSD", "USDP", "PAX", "DAI",
  "USDS", "USDE", "USD1", "RLUSD", "PYUSD", "AUSD", "USDQ", "USDR", "USDD",
  "XUSD", "U", "FIDD", "SOFID", "GUSD", "FRAX", "LUSD",
] as const;
export type MarketQuote = typeof USD_QUOTES[number];
export const MARKET_EXCHANGES = ["Binance", "OKX", "Bybit", "Coinbase", "Bitfinex", "Kraken"] as const;
export type MarketExchange = typeof MARKET_EXCHANGES[number];
export const FIXED_EXCHANGE_QUOTES: Record<MarketExchange, MarketQuote> = {
  Binance: "USDT", OKX: "USDT", Bybit: "USDT",
  Coinbase: "USD", Bitfinex: "USD", Kraken: "USD",
};
export type MarketSelection = {
  symbol: string;
  pair: string;
  quote: MarketQuote;
  tickSize: number;
};
export type MarketCandidate = MarketSelection & { volumeKey: string };
const quotes = new Set<string>(USD_QUOTES);

export function normalizeSymbol(value: unknown) {
  return String(value ?? "").toUpperCase();
}

function normalizeBase(exchange: MarketExchange, value: unknown) {
  const symbol = normalizeSymbol(value);
  const aliases: Record<string, string> = exchange === "Kraken"
    ? { XBT: "BTC", XXBT: "BTC", XDG: "DOGE", XXDG: "DOGE", XETH: "ETH" }
    : exchange === "Bitfinex" ? { UST: "USDT", UDC: "USDC", DSH: "DASH", IOT: "IOTA", QTM: "QTUM" } : {};
  return aliases[symbol] ?? symbol;
}

function normalizeQuote(exchange: MarketExchange, value: unknown): MarketQuote | null {
  let quote = normalizeSymbol(value);
  if (exchange === "Bitfinex") quote = ({ UST: "USDT", UDC: "USDC" } as Record<string, string>)[quote] ?? quote;
  if (exchange === "Kraken" && quote === "ZUSD") quote = "USD";
  return quotes.has(quote) ? quote as MarketQuote : null;
}

export function parseExchangeCandidates(exchange: MarketExchange, data: any) {
  const result = new Map<string, MarketCandidate[]>();
  const add = (base: unknown, quoteValue: unknown, pairValue: unknown, tickValue: unknown = 0, volumeKey?: string) => {
    const symbol = normalizeBase(exchange, base);
    const quote = normalizeQuote(exchange, quoteValue);
    const pair = String(pairValue ?? "").toUpperCase();
    if (!/^[A-Z0-9]{2,15}$/.test(symbol) || !quote || !pair || symbol.startsWith("TEST")) return;
    const tick = Number(tickValue);
    const market = { symbol, quote, pair, tickSize: Number.isFinite(tick) && tick > 0 ? tick : 0, volumeKey: volumeKey ?? pair };
    const candidates = result.get(symbol) ?? [];
    if (!candidates.some((entry) => entry.pair === pair)) candidates.push(market);
    result.set(symbol, candidates);
  };
  if (exchange === "Binance") {
    if (!Array.isArray(data?.symbols)) throw new Error("Binance 市場目錄回應異常");
    for (const item of data.symbols) if (item.status === "TRADING" && item.isSpotTradingAllowed !== false) {
      add(item.baseAsset, item.quoteAsset, item.symbol, item.filters?.find((filter: any) => filter.filterType === "PRICE_FILTER")?.tickSize);
    }
  } else if (exchange === "OKX") {
    if ((data?.code && data.code !== "0") || !Array.isArray(data?.data)) throw new Error("OKX 市場目錄回應異常");
    for (const item of data.data) if (item.state === "live" && item.instType === "SPOT") add(item.baseCcy, item.quoteCcy, item.instId, item.tickSz);
  } else if (exchange === "Bybit") {
    if ((data?.retCode && data.retCode !== 0) || !Array.isArray(data?.result?.list)) throw new Error("Bybit 市場目錄回應異常");
    for (const item of data.result.list) if (item.status === "Trading") add(item.baseCoin, item.quoteCoin, item.symbol, item.priceFilter?.tickSize);
  } else if (exchange === "Coinbase") {
    if (!Array.isArray(data)) throw new Error("Coinbase 市場目錄回應異常");
    for (const item of data) if (item.status === "online" && !item.trading_disabled && !item.cancel_only) add(item.base_currency, item.quote_currency, item.id, item.quote_increment);
  } else if (exchange === "Bitfinex") {
    if (!Array.isArray(data?.[0])) throw new Error("Bitfinex 市場目錄回應異常");
    // Unseparated legacy symbols use a three-letter quote; longer codes use a colon.
    const quoteCodes = ["USD", "UST", "UDC", ...USD_QUOTES.filter(q => !["USD", "XUSD"].includes(q))];
    for (const raw of data[0]) {
      const pair = String(raw).replace(/^t/, "").toUpperCase();
      const [base, quote] = pair.includes(":") ? pair.split(":") : (() => {
        const suffix = quoteCodes.find((code) => pair.endsWith(code));
        return suffix ? [pair.slice(0, -suffix.length), suffix] : ["", ""];
      })();
      add(base, quote, pair);
    }
  } else if (exchange === "Kraken") {
    if (data?.error?.length || !data?.result) throw new Error("Kraken 市場目錄回應異常");
    for (const [key, item] of Object.entries(data.result) as [string, any][]) {
      if (item.status && item.status !== "online") continue;
      const [wsBase, wsQuote] = String(item.wsname ?? "").split("/");
      add(wsBase || item.base, wsQuote || item.quote, item.altname || key.replace("/", ""), item.tick_size ?? 10 ** -Number(item.pair_decimals ?? 0), key);
    }
  }
  return result;
}

export const CATALOG_ENDPOINTS: Record<MarketExchange, string> = {
  Binance: "https://data-api.binance.vision/api/v3/exchangeInfo",
  OKX: "https://www.okx.com/api/v5/public/instruments?instType=SPOT",
  Bybit: "https://api.bybit.com/v5/market/instruments-info?category=spot",
  Coinbase: "https://api.exchange.coinbase.com/products",
  Bitfinex: "https://api-pub.bitfinex.com/v2/conf/pub:list:pair:exchange",
  Kraken: "https://api.kraken.com/0/public/AssetPairs?assetVersion=1",
};
export const TICKER_ENDPOINTS: Record<MarketExchange, string> = {
  Binance: "https://data-api.binance.vision/api/v3/ticker/24hr",
  OKX: "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
  Bybit: "https://api.bybit.com/v5/market/tickers?category=spot",
  Coinbase: "https://api.exchange.coinbase.com/products/stats",
  Bitfinex: "https://api-pub.bitfinex.com/v2/tickers?symbols=ALL",
  Kraken: "https://api.kraken.com/0/public/Ticker?assetVersion=1",
};

export function parseTickerVolumes(exchange: MarketExchange, data: any) {
  const volumes = new Map<string, number>();
  const add = (pair: unknown, raw: unknown) => {
    const number = raw === undefined || raw === null || raw === "" ? NaN : Number(raw);
    if (Number.isFinite(number) && number >= 0) volumes.set(String(pair).toUpperCase(), number);
  };
  if (exchange === "Binance" && Array.isArray(data)) for (const row of data) add(row.symbol, row.volume);
  else if (exchange === "OKX" && (!data?.code || data.code === "0")) for (const row of data?.data ?? []) add(row.instId, row.vol24h);
  else if (exchange === "Bybit" && (!data?.retCode || data.retCode === 0)) for (const row of data?.result?.list ?? []) add(row.symbol, row.volume24h);
  else if (exchange === "Coinbase") for (const [pair, row] of Object.entries(data ?? {}) as [string, any][]) add(pair, row?.stats_24hour?.volume);
  else if (exchange === "Bitfinex" && Array.isArray(data)) for (const row of data) { if (String(row[0]).startsWith("t")) add(row[0].slice(1), row[8]); }
  else if (exchange === "Kraken" && !data?.error?.length) for (const [pair, row] of Object.entries(data?.result ?? {}) as [string, any][]) add(pair, row.v?.[1]);
  return volumes;
}
