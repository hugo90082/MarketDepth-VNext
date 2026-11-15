import {requestMarket} from '../runtime/client';
"use client";

import { DEPTH_OPTIONS, depthKey, responseAtDepth, type AggregateRange, type DepthOption, type DepthResponse, type SourceResult } from "./depth-types";
import { type MarketMetaBatchResponse } from "./market-meta";

type WorkerResponse = {
  id: number;
  ok: boolean;
  result?: SourceResult
    | { source: SourceResult; nextLimit: number }
    | { payload: DepthResponse; nextLimit: number }
    | MarketMetaBatchResponse;
  symbols?: string[];
  error?: string;
};

type WorkerPending = {
  resolve: (value: WorkerResponse) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
};

export type BrowserMarketSupport = {
  knownExchanges: string[];
  supportedExchanges: string[];
};

const BINANCE_PROFILE_KEY = "depthwatch-binance-profiles";
const BINANCE_NEGATIVE_KEY = "depthwatch-binance-negative";
const FUTURES_KEY = "depthwatch-binance-futures";
const SIX_HOURS = 6 * 60 * 60 * 1000;
const CORE_SYMBOLS = new Set(["BTC", "ETH", "SOL"]);

function workerRequest(message: Record<string,unknown>, timeoutMs=30000, signal?:AbortSignal):Promise<WorkerResponse> {return requestMarket(message,timeoutMs,signal) as Promise<WorkerResponse>;}

function readTimedMap(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, { value: number; expires: number }>;
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item?.expires > Date.now()));
  } catch {
    return {};
  }
}

function writeTimedMap(key: string, value: Record<string, { value: number; expires: number }>) {
  localStorage.setItem(key, JSON.stringify(value));
}

function binanceLimit(symbol: string) {
  const profiles = readTimedMap(BINANCE_PROFILE_KEY);
  return profiles[symbol]?.value === 5000 || CORE_SYMBOLS.has(symbol) ? 5000 : 1000;
}

function saveBinanceLimit(symbol: string, limit: number) {
  const profiles = readTimedMap(BINANCE_PROFILE_KEY);
  profiles[symbol] = { value: limit === 5000 ? 5000 : 1000, expires: Date.now() + SIX_HOURS };
  writeTimedMap(BINANCE_PROFILE_KEY, profiles);
}

function saveBinanceUnsupported(symbol: string) {
  const values = readTimedMap(BINANCE_NEGATIVE_KEY);
  values[symbol] = { value: 1, expires: Date.now() + SIX_HOURS };
  writeTimedMap(BINANCE_NEGATIVE_KEY, values);
}

function aggregateAtDepth(sources: SourceResult[], depth: number): AggregateRange {
  const ranges = sources.map((source) => source.ranges[depthKey(depth)]).filter(Boolean);
  const usable = ranges.filter((range) => (range.status === "ok" || range.status === "partial") && range.bids + range.asks > 0);
  const bids = usable.reduce((sum, range) => sum + range.bids, 0);
  const asks = usable.reduce((sum, range) => sum + range.asks, 0);
  const instantComplete = usable.filter((range) => range.completeness === "instant").length;
  const mergedComplete = usable.filter((range) => range.completeness === "merged").length;
  return {
    bids,
    asks,
    imbalance: usable.length && bids + asks ? (bids - asks) / (bids + asks) : null,
    success: usable.length,
    complete: instantComplete + mergedComplete,
    instantComplete,
    mergedComplete,
  };
}

function replaceSources(payload: DepthResponse, replacements: SourceResult[]) {
  const byExchange = new Map(replacements.map((source) => [source.exchange, source]));
  const existing = new Set(payload.sources.map((source) => source.exchange));
  const sources = payload.sources.map((source) => byExchange.get(source.exchange) ?? source);
  replacements.forEach((source) => {
    if (!existing.has(source.exchange)) sources.push(source);
  });
  const ranges = Object.fromEntries(DEPTH_OPTIONS.map((depth) => [depthKey(depth), aggregateAtDepth(sources, depth)]));
  return responseAtDepth({ ...payload, sources, ranges }, payload.depth);
}

function sourceUsable(source: SourceResult) {
  return (source.status === "ok" || source.status === "partial") && source.bids + source.asks > 0;
}

export function missingBrowserExchanges(payload: DepthResponse) {
  return payload.sources
    .filter((source) => !sourceUsable(source) || !source.coverageVerified)
    .map((source) => source.exchange);
}

export async function loadBrowserDepth(
  symbol: string,
  marketSupport?: BrowserMarketSupport,
  signal?: AbortSignal,
) {
  const response = await workerRequest({
    type: "aggregate",
    symbol,
    limit: binanceLimit(symbol),
    knownExchanges: marketSupport?.knownExchanges ?? [],
    supportedExchanges: marketSupport?.supportedExchanges ?? [],
  }, 31_000, signal);
  const result = response.result as { payload: DepthResponse; nextLimit: number } | undefined;
  if (!response.ok || !result?.payload) throw new Error(response.error ?? "瀏覽器直連聚合失敗");
  saveBinanceLimit(symbol, result.nextLimit);
  const binance = result.payload.sources.find((source) => source.exchange === "Binance");
  if (binance?.status === "unsupported") saveBinanceUnsupported(symbol);
  return result.payload;
}

export function mergeCloudFallbacks(browserPayload: DepthResponse, cloudPayload: DepthResponse) {
  const browserByExchange = new Map(browserPayload.sources.map((source) => [source.exchange, source]));
  const replacements = cloudPayload.sources.map((source): SourceResult => {
    const browserSource = browserByExchange.get(source.exchange);
    if (!browserSource) return source;
    if (!sourceUsable(browserSource) && source.status === "unsupported") {
      return {
        ...source,
        acquisitionMode: "cloud-fallback",
        fallbackReason: browserSource.error ?? browserSource.fallbackReason ?? "瀏覽器直連未取得",
      };
    }
    const cloudImprovesCoverage = sourceUsable(source) && (
      !sourceUsable(browserSource)
      || (source.coverageVerified && !browserSource.coverageVerified)
      || source.bidCoverage + source.askCoverage > browserSource.bidCoverage + browserSource.askCoverage + 0.01
    );
    if (!cloudImprovesCoverage) return browserSource;
    return {
      ...source,
      acquisitionMode: "cloud-fallback",
      fallbackReason: browserSource.error ?? browserSource.fallbackReason ?? "瀏覽器直連未取得",
    };
  });
  const merged = replaceSources(browserPayload, replacements);
  return {
    ...merged,
    binancePerp: browserPayload.binancePerp || cloudPayload.binancePerp,
    generatedAt: Math.max(browserPayload.generatedAt, cloudPayload.generatedAt),
  };
}

export async function applyBrowserFallbacks(payload: DepthResponse, symbol: string) {
  try {
    return mergeCloudFallbacks(await loadBrowserDepth(symbol), payload);
  } catch {
    return payload;
  }
}

export async function loadBinancePerpetuals() {
  try {
    const cached = JSON.parse(localStorage.getItem(FUTURES_KEY) ?? "null") as { symbols: string[]; expires: number } | null;
    if (cached && cached.expires > Date.now() && Array.isArray(cached.symbols)) return new Set(cached.symbols);
  } catch {
    // Rebuild corrupt local cache from the public catalog.
  }
  const response = await workerRequest({ type: "futures" }, 45_000);
  if (!response.ok || !Array.isArray(response.symbols)) throw new Error(response.error ?? "無法取得 Binance 永續合約目錄");
  localStorage.setItem(FUTURES_KEY, JSON.stringify({ symbols: response.symbols, expires: Date.now() + SIX_HOURS }));
  return new Set(response.symbols);
}

export async function loadBrowserMarketMeta(symbols: readonly string[]) {
  const normalized = [...new Set(
    symbols.map((symbol) => symbol.toUpperCase()).filter((symbol) => (
      /^[A-Z0-9]{2,15}$/.test(symbol)
    )),
  )];
  if (normalized.length === 0 || normalized.length > 20) {
    throw new Error("行情批次必須包含 1～20 個有效商品");
  }
  const response = await workerRequest({
    type: "market-meta",
    symbols: normalized,
  }, 45_000);
  const result = response.result as MarketMetaBatchResponse | undefined;
  if (!response.ok || !result?.items) {
    throw new Error(response.error ?? "瀏覽器直連行情失敗");
  }
  return result;
}

export function selectDepth(payload: DepthResponse, depth: DepthOption) {
  return responseAtDepth(payload, depth);
}
