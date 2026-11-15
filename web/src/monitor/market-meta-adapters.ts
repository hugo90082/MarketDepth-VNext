/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  type MarketMetaBatchResponse,
  type MarketMetaCandidate,
  type MarketMetaExchange,
} from "./market-meta.ts";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeBase(value: unknown) {
  const base = asString(value).toUpperCase();
  if (base === "XBT") return "BTC";
  if (base === "XDG") return "DOGE";
  return base;
}

function requestedSet(symbols: readonly string[]) {
  return new Set(symbols.map((symbol) => normalizeBase(symbol)));
}

function positivePrice(value: unknown) {
  const price = asNumber(value);
  return price !== null && price > 0 ? price : null;
}

function unixTime(value: unknown, fallback: number) {
  const parsed = asNumber(value);
  if (parsed === null) return fallback;
  return fallback > 10_000_000_000 && parsed < 10_000_000_000
    ? parsed * 1000
    : parsed;
}

function candidate(
  symbol: string,
  exchange: MarketMetaExchange,
  pair: string,
  price: number,
  predictedFundingRate: number | null,
  fundingIntervalHours: number | null,
  generatedAt: number,
): MarketMetaCandidate {
  return {
    symbol,
    exchange,
    pair,
    price,
    predictedFundingRate,
    fundingIntervalHours,
    generatedAt,
  };
}

export function parseBinanceMarketMeta(
  symbols: readonly string[],
  payload: {
    prices?: any[];
    premiums?: any[];
    fundingInfo?: any[];
  },
  generatedAt = Date.now(),
) {
  const wanted = requestedSet(symbols);
  const premiums = new Map(
    (payload.premiums ?? []).map((item) => [asString(item.symbol), item]),
  );
  const intervals = new Map(
    (payload.fundingInfo ?? []).map((item) => [
      asString(item.symbol),
      asNumber(item.fundingIntervalHours),
    ]),
  );

  return (payload.prices ?? []).flatMap((item): MarketMetaCandidate[] => {
    const pair = asString(item.symbol).toUpperCase();
    if (!pair.endsWith("USDT")) return [];
    const symbol = normalizeBase(pair.slice(0, -4));
    const price = positivePrice(item.price);
    if (!wanted.has(symbol) || price === null) return [];
    const premium = premiums.get(pair);
    return [candidate(
      symbol,
      "Binance",
      pair,
      price,
      asNumber(premium?.lastFundingRate ?? premium?.fundingRate),
      intervals.get(pair) ?? 8,
      unixTime(item.time ?? premium?.time, generatedAt),
    )];
  });
}

export function parseOkxMarketMeta(
  symbols: readonly string[],
  payload: {
    tickers?: any[];
    funding?: Record<string, any>;
  },
  generatedAt = Date.now(),
) {
  const wanted = requestedSet(symbols);
  return (payload.tickers ?? []).flatMap((item): MarketMetaCandidate[] => {
    const pair = asString(item.instId).toUpperCase();
    const match = /^(.+)-(?:USDT|USD)-SWAP$/.exec(pair);
    const symbol = normalizeBase(match?.[1]);
    const price = positivePrice(item.last);
    if (!match || !wanted.has(symbol) || price === null) return [];
    const funding = payload.funding?.[pair];
    const currentTime = asNumber(funding?.fundingTime);
    const previousTime = asNumber(funding?.prevFundingTime);
    const nextTime = asNumber(funding?.nextFundingTime);
    const intervalMs = (
      currentTime !== null && previousTime !== null && currentTime > previousTime
        ? currentTime - previousTime
        : currentTime !== null && nextTime !== null && nextTime > currentTime
          ? nextTime - currentTime
          : null
    );
    return [candidate(
      symbol,
      "OKX",
      pair,
      price,
      asNumber(funding?.nextFundingRate || funding?.fundingRate),
      intervalMs === null ? null : intervalMs / 3_600_000,
      unixTime(item.ts ?? funding?.ts, generatedAt),
    )];
  });
}

export function parseBybitMarketMeta(
  symbols: readonly string[],
  tickers: any[],
  generatedAt = Date.now(),
) {
  const wanted = requestedSet(symbols);
  return (tickers ?? []).flatMap((item): MarketMetaCandidate[] => {
    const pair = asString(item.symbol).toUpperCase();
    if (!pair.endsWith("USDT")) return [];
    const symbol = normalizeBase(pair.slice(0, -4));
    const price = positivePrice(item.lastPrice);
    if (!wanted.has(symbol) || price === null) return [];
    return [candidate(
      symbol,
      "Bybit",
      pair,
      price,
      asNumber(item.fundingRate),
      asNumber(item.fundingIntervalHour),
      unixTime(item.time, generatedAt),
    )];
  });
}

function intervalHours(value: unknown) {
  const text = asString(value).trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*([smhd])$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  if (match[2] === "s") return amount / 3600;
  if (match[2] === "m") return amount / 60;
  if (match[2] === "d") return amount * 24;
  return amount;
}

export function parseCoinbaseMarketMeta(
  symbols: readonly string[],
  products: any[],
  generatedAt = Date.now(),
) {
  const wanted = requestedSet(symbols);
  return (products ?? []).flatMap((item): MarketMetaCandidate[] => {
    const details = item.future_product_details ?? {};
    const symbol = normalizeBase(
      details.contract_root_unit
      ?? asString(item.display_name).split(/\s+/)[0],
    );
    const price = positivePrice(item.price);
    const pair = asString(item.product_id);
    if (!wanted.has(symbol) || !pair || price === null) return [];
    return [candidate(
      symbol,
      "Coinbase",
      pair,
      price,
      asNumber(details.funding_rate),
      intervalHours(details.funding_interval),
      unixTime(item.price_percentage_change_24h_timestamp, generatedAt),
    )];
  });
}

function bitfinexBase(pair: string) {
  const match = /^t?(.+?)F0:(?:UST|USD)F0$/i.exec(pair);
  return normalizeBase(match?.[1]);
}

export function parseBitfinexMarketMeta(
  symbols: readonly string[],
  payload: {
    tickers?: any[][];
    status?: Record<string, any[]>;
  },
  generatedAt = Date.now(),
) {
  const wanted = requestedSet(symbols);
  return (payload.tickers ?? []).flatMap((item): MarketMetaCandidate[] => {
    const pair = asString(item[0]);
    const symbol = bitfinexBase(pair);
    const status = payload.status?.[pair];
    const price = positivePrice(item[7] ?? status?.[2]);
    if (!wanted.has(symbol) || price === null) return [];
    return [candidate(
      symbol,
      "Bitfinex",
      pair,
      price,
      asNumber(status?.[8]),
      8,
      unixTime(status?.[0], generatedAt),
    )];
  });
}

export function parseKrakenMarketMeta(
  symbols: readonly string[],
  tickers: any[],
  generatedAt = Date.now(),
) {
  const wanted = requestedSet(symbols);
  return (tickers ?? []).flatMap((item): MarketMetaCandidate[] => {
    const pair = asString(item.symbol).toUpperCase();
    if (item.tag !== "perpetual" && !pair.startsWith("PF_")) return [];
    const base = pair.startsWith("PF_")
      ? pair.slice(3).replace(/(?:USDT|USD)$/i, "")
      : asString(item.pair).split(":")[0];
    const symbol = normalizeBase(base);
    const price = positivePrice(item.last);
    const percentRate = asNumber(item.fundingRatePrediction);
    if (!wanted.has(symbol) || price === null) return [];
    return [candidate(
      symbol,
      "Kraken",
      pair,
      price,
      percentRate === null ? null : percentRate / 100,
      1,
      unixTime(item.time, generatedAt),
    )];
  });
}

async function getJson(fetcher: FetchLike, url: string) {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json" },
    });
  } catch (directError) {
    if (fetcher !== fetch || typeof location === "undefined") throw directError;
    response = await fetch(`/api/exchange-proxy?url=${encodeURIComponent(url)}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<any>;
}

function addMissing(
  items: Record<string, MarketMetaCandidate[]>,
  candidates: MarketMetaCandidate[],
) {
  for (const entry of candidates) {
    if ((items[entry.symbol]?.length ?? 0) === 0) {
      items[entry.symbol] = [entry];
    }
  }
}

function unresolvedSymbols(
  symbols: readonly string[],
  items: Record<string, MarketMetaCandidate[]>,
) {
  return symbols.filter((symbol) => (items[symbol]?.length ?? 0) === 0);
}

async function loadBinance(
  symbols: readonly string[],
  fetcher: FetchLike,
  now: number,
) {
  const [prices, premiums] = await Promise.all([
    getJson(fetcher, "https://fapi.binance.com/fapi/v2/ticker/price"),
    getJson(fetcher, "https://fapi.binance.com/fapi/v1/premiumIndex"),
  ]);
  let fundingInfo: any[] = [];
  try {
    fundingInfo = await getJson(
      fetcher,
      "https://fapi.binance.com/fapi/v1/fundingInfo",
    );
  } catch {
    // Binance 的非預設結算週期清單不是取得行情的必要條件。
  }
  return parseBinanceMarketMeta(symbols, { prices, premiums, fundingInfo }, now);
}

async function loadOkx(
  symbols: readonly string[],
  fetcher: FetchLike,
  now: number,
) {
  const tickerPayload = await getJson(
    fetcher,
    "https://www.okx.com/api/v5/market/tickers?instType=SWAP",
  );
  const candidates = parseOkxMarketMeta(symbols, {
    tickers: tickerPayload.data ?? [],
  }, now);
  await Promise.all(candidates.map(async (entry) => {
    try {
      const fundingPayload = await getJson(
        fetcher,
        `https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(entry.pair)}`,
      );
      const funding = fundingPayload.data?.[0];
      if (!funding) return;
      entry.predictedFundingRate = asNumber(
        funding.nextFundingRate || funding.fundingRate,
      );
      const current = asNumber(funding.fundingTime);
      const previous = asNumber(funding.prevFundingTime);
      const next = asNumber(funding.nextFundingTime);
      const delta = (
        current !== null && previous !== null && current > previous
          ? current - previous
          : current !== null && next !== null && next > current
            ? next - current
            : null
      );
      entry.fundingIntervalHours = delta === null ? null : delta / 3_600_000;
      entry.generatedAt = unixTime(funding.ts, entry.generatedAt);
    } catch {
      // 價格仍可顯示；費率保持不可用。
    }
  }));
  return candidates;
}

async function loadBybit(
  symbols: readonly string[],
  fetcher: FetchLike,
  now: number,
) {
  const payload = await getJson(
    fetcher,
    "https://api.bybit.com/v5/market/tickers?category=linear",
  );
  return parseBybitMarketMeta(symbols, payload.result?.list ?? [], now);
}

async function loadCoinbase(
  symbols: readonly string[],
  fetcher: FetchLike,
  now: number,
) {
  const payload = await getJson(
    fetcher,
    "https://api.coinbase.com/api/v3/brokerage/market/products?product_type=FUTURE&limit=500",
  );
  return parseCoinbaseMarketMeta(symbols, payload.products ?? [], now);
}

async function loadBitfinex(
  symbols: readonly string[],
  fetcher: FetchLike,
  now: number,
) {
  const tickerRows = await getJson(
    fetcher,
    "https://api-pub.bitfinex.com/v2/tickers?symbols=ALL",
  );
  const derivativeRows = (tickerRows as any[][]).filter((row) => (
    /^t.+F0:(?:UST|USD)F0$/i.test(asString(row[0]))
  ));
  const keys = derivativeRows.map((row) => row[0]).join(",");
  let status: Record<string, any[]> = {};
  if (keys) {
    const rows = await getJson(
      fetcher,
      `https://api-pub.bitfinex.com/v2/status/deriv?keys=${encodeURIComponent(keys)}`,
    );
    status = Object.fromEntries((rows as any[][]).map((row) => [
      row[0],
      [row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]],
    ]));
  }
  return parseBitfinexMarketMeta(
    symbols,
    { tickers: derivativeRows, status },
    now,
  );
}

async function loadKraken(
  symbols: readonly string[],
  fetcher: FetchLike,
  now: number,
) {
  const payload = await getJson(
    fetcher,
    "https://futures.kraken.com/derivatives/api/v3/tickers",
  );
  return parseKrakenMarketMeta(symbols, payload.tickers ?? [], now);
}

export async function loadMarketMetaCandidates(
  inputSymbols: readonly string[],
  fetcher: FetchLike = fetch,
  now = Date.now(),
): Promise<MarketMetaBatchResponse> {
  const symbols = [...new Set(inputSymbols.map(normalizeBase).filter(Boolean))];
  const items = Object.fromEntries(
    symbols.map((symbol) => [symbol, [] as MarketMetaCandidate[]]),
  );
  const errors: Partial<Record<MarketMetaExchange, string>> = {};
  const loaders: Array<[
    MarketMetaExchange,
    (
      unresolved: readonly string[],
      activeFetcher: FetchLike,
      generatedAt: number,
    ) => Promise<MarketMetaCandidate[]>,
  ]> = [
    ["Binance", loadBinance],
    ["OKX", loadOkx],
    ["Bybit", loadBybit],
    ["Coinbase", loadCoinbase],
    ["Bitfinex", loadBitfinex],
    ["Kraken", loadKraken],
  ];

  for (const [exchange, loader] of loaders) {
    const unresolved = unresolvedSymbols(symbols, items);
    if (unresolved.length === 0) break;
    try {
      addMissing(items, await loader(unresolved, fetcher, now));
    } catch (error) {
      errors[exchange] = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    generatedAt: now,
    items,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };
}
