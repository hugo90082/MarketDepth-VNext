/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEPTH_OPTIONS, responseAtDepth, type DepthOption, type DepthResponse, type Quote } from "../depth-types";
import { MARKET_EXCHANGES } from "../market-catalog";
import { resolveFixedMarket } from "../market-selection-server";
import { FIXED_EXCHANGE_QUOTES, type MarketSelection } from "../market-ranking";
import { classifyOkxBookResponse, classifyKrakenBookResponse } from "../exchange-errors";
import {krakenGrouping} from '../kraken-grouping';
import { createDepthEngine, type DepthSourceAdapter } from "./engine.ts";
import { createRawBook, normalizeLevels as asLevels, type Level, type RawBook } from "./order-book.ts";
import { createSharedResultCache } from "./result-cache.ts";
import { createRateLimiter } from "./rate-limiter.ts";
import { withAbortDeadline } from "../request-deadline.ts";

export type Exchange = typeof EXCHANGES[number];
type CacheEntry<T> = { value: T; expires: number };
type LiveBookState = {
  exchange: "Binance" | "Bybit";
  pair: string;
  quote: Quote;
  snapshotLimit: number;
  bids: Map<string, number>;
  asks: Map<string, number>;
  updatedAt: number;
  lastUpdateId: number;
  ready: boolean;
  synchronized: boolean;
  buffer: any[];
  socket?: WebSocket;
  heartbeat?: ReturnType<typeof setInterval>;
  readyPromise?: Promise<void>;
  resolveReady?: () => void;
  feed?: string;
};

export const EXCHANGES = MARKET_EXCHANGES;
const BINANCE_SPOT_REST = "https://data-api.binance.vision";
const BINANCE_SPOT_WS = "wss://data-stream.binance.vision";
export const ALLOWED_DEPTHS = new Set<number>(DEPTH_OPTIONS);
const FIXED_INTERVALS: Record<Exclude<Exchange, "Binance">, number> = {
  OKX: 250,
  Bybit: 11,
  Coinbase: 1000,
  Bitfinex: 313,
  Kraken: 1250,
};
const RESULT_CACHE_MS = 3000;
const PAIR_CACHE_MS = 6 * 60 * 60 * 1000;
const SOFT_DEADLINE_MS = 30_000;
const MERGE_WINDOW_MS = 5000;
const LIVE_BOOK_STALE_MS = 15_000;
const MAX_TARGET_DEPTH: DepthOption = 10;
const DEFAULT_BINANCE_MS_PER_WEIGHT = 12.5;
const CORE_BINANCE_SYMBOLS = new Set(["BTC", "ETH", "SOL"]);

const pairCache = new Map<string, CacheEntry<MarketSelection>>();
const krakenGroupings = new Map<string, CacheEntry<number>&{tick:number}>();
const bookInflight = new Map<string, Promise<RawBook>>();
const liveBooks = new Map<string, LiveBookState>();
const recentRestBooks = new Map<string, RawBook>();
const binanceDepthLimits = new Map<string, CacheEntry<1000 | 5000>>();
let binanceMsPerWeightCache: CacheEntry<number> | null = null;
let binanceMsPerWeightInflight: Promise<number> | null = null;
const sharedResults = createSharedResultCache<DepthResponse>({ ttlMs: RESULT_CACHE_MS });

class UnsupportedError extends Error {}
class UpstreamError extends Error {
  status: number;
  retryAfterMs: number;
  constructor(message: string, status = 502, retryAfterMs = 0) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function readJson(url: string, signal?: AbortSignal) {
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "DepthWatch/2.0" },
        signal,
      });
    } catch (directError) {
      if (typeof location === "undefined") throw directError;
      response = await fetch(`/api/exchange-proxy?url=${encodeURIComponent(url)}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal,
      });
    }
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > 8_000_000) throw new UpstreamError("上游回應過大");
    const text = await response.text();
    if (text.length > 8_000_000) throw new UpstreamError("上游回應過大");
    if (!response.ok) {
      if (response.status === 400 || response.status === 404) throw new UpstreamError(`上游 HTTP ${response.status}`,response.status);
      if (response.status === 403 || response.status === 451) throw new UpstreamError("上游地區限制", response.status);
      if (response.status === 418 || response.status === 429) {
        const retry = response.headers.get("retry-after");
        const label = response.status === 418 ? "IP 暫時封鎖（418）" : "請求過多（429）";
        throw new UpstreamError(`${label}${retry ? `，Retry-After ${retry}` : ""}`, response.status, parseRetryAfter(retry));
      }
      throw new UpstreamError(`上游 HTTP ${response.status}`, response.status);
    }
    try { return JSON.parse(text); }
    catch { throw new UpstreamError("上游回應不是有效 JSON"); }
  } catch (error) {
    if (error instanceof UnsupportedError || error instanceof UpstreamError) throw error;
    throw new UpstreamError(error instanceof Error ? error.message : "上游連線失敗");
  }
}

function rateWindowSeconds(interval: string, intervalNum: number) {
  const unit = interval === "SECOND" ? 1 : interval === "MINUTE" ? 60 : interval === "HOUR" ? 3600 : interval === "DAY" ? 86400 : 0;
  return unit * intervalNum;
}

async function loadBinanceMsPerWeight() {
  try {
    const data = await withAbortDeadline(
      (signal) => readJson(`${BINANCE_SPOT_REST}/api/v3/exchangeInfo`, signal),
      1_000,
      "Binance 限流資訊等待超過 1 秒",
    );
    const intervals = (data.rateLimits ?? [])
      .filter((item: any) => item.rateLimitType === "REQUEST_WEIGHT")
      .map((item: any) => {
        const seconds = rateWindowSeconds(String(item.interval), Number(item.intervalNum));
        const limit = Number(item.limit);
        if (!seconds || !limit) return 0;
        return (seconds * 1000) / (limit * 0.8);
      })
      .filter((value: number) => value > 0);
    const value = intervals.length ? Math.max(...intervals) : DEFAULT_BINANCE_MS_PER_WEIGHT;
    binanceMsPerWeightCache = { value, expires: Date.now() + PAIR_CACHE_MS };
    return value;
  } catch {
    return DEFAULT_BINANCE_MS_PER_WEIGHT;
  }
}

async function binanceInterval(weight: number) {
  if (binanceMsPerWeightCache && binanceMsPerWeightCache.expires > Date.now()) {
    return Math.ceil(binanceMsPerWeightCache.value * weight);
  }
  if (!binanceMsPerWeightInflight) {
    binanceMsPerWeightInflight = loadBinanceMsPerWeight().finally(() => { binanceMsPerWeightInflight = null; });
  }
  const msPerWeight = await Promise.race([
    binanceMsPerWeightInflight,
    sleep(1000).then(() => DEFAULT_BINANCE_MS_PER_WEIGHT),
  ]);
  return Math.ceil(msPerWeight * weight);
}

const rateLimiter = createRateLimiter({
  intervalFor: (exchange, weight) => exchange === "Binance"
    ? binanceInterval(weight)
    : FIXED_INTERVALS[exchange as Exclude<Exchange, "Binance">],
  sleep,
});

async function fetchJson(
  exchange: Exchange,
  url: string,
  signal: AbortSignal,
) {
  await rateLimiter.reserve(exchange, 1, signal);
  try {
    const value = await readJson(url, signal);
    rateLimiter.recordSuccess(exchange);
    return value;
  } catch (error) {
    if (error instanceof UpstreamError) rateLimiter.recordFailure(exchange, error);
    throw error;
  }
}

async function fetchBinanceJson(
  path: string,
  weight: number,
  signal: AbortSignal,
) {
  await rateLimiter.reserve("Binance", weight, signal);
  try {
    const data = await readJson(`${BINANCE_SPOT_REST}${path}`, signal);
    rateLimiter.recordSuccess("Binance");
    return { data };
  } catch (error) {
    if (error instanceof UpstreamError) rateLimiter.recordFailure("Binance", error);
    throw error;
  }
}

function bookOf(
  bids: Level[],
  asks: Level[],
  pair: string,
  quote: Quote,
  feed: string,
  metadata: Partial<Pick<RawBook, "acquisitionMode" | "tickSize" | "fallbackReason">> = {},
): RawBook {
  return createRawBook({
    bids,
    asks,
    pair,
    quote,
    feed,
    capturedAt: Date.now(),
    acquisitionMode: metadata.acquisitionMode ?? "cloud-fallback",
    tickSize: metadata.tickSize ?? 0,
    fallbackReason: metadata.fallbackReason,
  });
}

const priceKey = (price: number) => price.toFixed(12).replace(/\.?0+$/, "");

function applyLevels(target: Map<string, number>, levels: Level[]) {
  levels.forEach(([price, quantity]) => {
    const key = priceKey(price);
    if (quantity === 0) target.delete(key);
    else target.set(key, quantity);
  });
}

function liveKey(exchange: "Binance" | "Bybit", pair: string) { return `${exchange}:${pair}`; }

function closeLiveState(key: string) {
  const state = liveBooks.get(key);
  if (!state) return;
  if (state.heartbeat) clearInterval(state.heartbeat);
  try { state.socket?.close(); } catch { /* connection may already be closed */ }
  liveBooks.delete(key);
}

function closeSymbolLiveBooks(exchange: Exchange, symbol: string) {
  if (exchange !== "Binance" && exchange !== "Bybit") return;
  for (const [key, state] of liveBooks) {
    if (state.exchange === exchange && state.pair === pairCache.get(`${exchange}:${symbol}`)?.value.pair) closeLiveState(key);
  }
}

function liveBook(state: LiveBookState, feed: string): RawBook {
  return {
    bids: [...state.bids].map(([price, quantity]): Level => [Number(price), quantity]).sort((a, b) => b[0] - a[0]),
    asks: [...state.asks].map(([price, quantity]): Level => [Number(price), quantity]).sort((a, b) => a[0] - b[0]),
    pair: state.pair, quote: state.quote, feed, capturedAt: state.updatedAt,
    snapshotCount: 1, mergeWindowMs: 0, temporalMerged: false,
    acquisitionMode: "cloud-fallback", tickSize: 0,
  };
}

function webSocketConstructor() {
  return (globalThis as typeof globalThis & { WebSocket?: typeof WebSocket }).WebSocket;
}

function createLiveState(exchange: "Binance" | "Bybit", pair: string, quote: Quote, snapshotLimit = 0) {
  let resolveReady: (() => void) | undefined;
  const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });
  const state: LiveBookState = {
    exchange, pair, quote, snapshotLimit, bids: new Map(), asks: new Map(), updatedAt: 0,
    lastUpdateId: 0, ready: false, synchronized: false, buffer: [], readyPromise, resolveReady,
  };
  liveBooks.set(liveKey(exchange, pair), state);
  return state;
}

function applyBinanceEvent(state: LiveBookState, event: any) {
  const first = Number(event.U);
  const last = Number(event.u);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= state.lastUpdateId) return true;
  if (first > state.lastUpdateId + 1) return false;
  applyLevels(state.bids, asLevels(event.b));
  applyLevels(state.asks, asLevels(event.a));
  state.lastUpdateId = last;
  state.updatedAt = Number(event.E) || Date.now();
  state.synchronized = true;
  return true;
}

function startBinanceStream(
  state: LiveBookState,
  wsBase: string,
  signal: AbortSignal,
) {
  const WebSocketCtor = webSocketConstructor();
  if (!WebSocketCtor) return;
  const key = liveKey("Binance", state.pair);
  signal.addEventListener("abort", () => closeLiveState(key), { once: true });
  try {
    const socket = new WebSocketCtor(`${wsBase}/ws/${state.pair.toLowerCase()}@depth@100ms`);
    state.socket = socket;
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data));
        if (event.e !== "depthUpdate") return;
        if (!state.ready) { state.buffer.push(event); return; }
        if (!applyBinanceEvent(state, event)) closeLiveState(key);
      } catch { /* malformed updates are ignored */ }
    };
    socket.onclose = () => { if (liveBooks.get(key) === state) state.synchronized = false; };
    socket.onerror = () => { state.synchronized = false; };
  } catch { state.synchronized = false; }
}

function binanceLimitFor(symbol: string): 1000 | 5000 {
  const cached = binanceDepthLimits.get(symbol);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = CORE_BINANCE_SYMBOLS.has(symbol) ? 5000 : 1000;
  binanceDepthLimits.set(symbol, { value, expires: Date.now() + PAIR_CACHE_MS });
  return value;
}

function binanceDepthWeight(limit: number) {
  if (limit <= 100) return 5;
  if (limit <= 500) return 25;
  if (limit <= 1000) return 50;
  return 250;
}

async function binanceBook(
  symbol: string,
  quote: Quote,
  signal: AbortSignal,
  selectedPair: string,
): Promise<RawBook> {
  const pair = selectedPair;
  const key = liveKey("Binance", pair);
  const limit = binanceLimitFor(symbol);
  const existing = liveBooks.get(key);
  if (existing?.ready && existing.snapshotLimit >= limit && Date.now() - existing.updatedAt <= LIVE_BOOK_STALE_MS) {
    return liveBook(existing, existing.feed ?? (existing.synchronized ? `REST ${existing.snapshotLimit} + Diff WebSocket` : `REST ${existing.snapshotLimit}`));
  }
  if (existing) closeLiveState(key);
  const state = createLiveState("Binance", pair, quote, limit);
  try {
    const { data } = await fetchBinanceJson(
      `/api/v3/depth?symbol=${pair}&limit=${limit}`,
      binanceDepthWeight(limit),
      signal,
    );
    if (data.code) throw new UnsupportedError(data.msg ?? "交易對不存在");
    applyLevels(state.bids, asLevels(data.bids));
    applyLevels(state.asks, asLevels(data.asks));
    state.lastUpdateId = Number(data.lastUpdateId) || 0;
    state.updatedAt = Date.now();
    state.ready = true;
    startBinanceStream(state, BINANCE_SPOT_WS, signal);
    const buffered = state.buffer.splice(0).filter((event) => Number(event.u) > state.lastUpdateId);
    const firstApplicable = buffered.findIndex((event) => Number(event.U) <= state.lastUpdateId + 1 && Number(event.u) >= state.lastUpdateId + 1);
    if (firstApplicable >= 0) {
      state.synchronized = buffered.slice(firstApplicable).every((event) => applyBinanceEvent(state, event));
    }
    state.feed = `REST ${limit}${state.synchronized ? " + Diff WebSocket" : ""}`;
    state.resolveReady?.();
    return liveBook(state, state.feed);
  } catch (error) {
    closeLiveState(key);
    throw error;
  }
}

function startBybitStream(
  pair: string,
  quote: Quote,
  signal: AbortSignal,
) {
  const key = liveKey("Bybit", pair);
  const existing = liveBooks.get(key);
  if (existing) return existing;
  const state = createLiveState("Bybit", pair, quote);
  signal.addEventListener("abort", () => closeLiveState(key), { once: true });
  const WebSocketCtor = webSocketConstructor();
  if (!WebSocketCtor) return state;
  try {
    const socket = new WebSocketCtor("wss://stream.bybit.com/v5/public/spot");
    state.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ op: "subscribe", args: [`orderbook.1000.${pair}`] }));
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data));
        if (payload.topic !== `orderbook.1000.${pair}` || !payload.data) return;
        const snapshot = payload.type === "snapshot" || Number(payload.data.u) === 1;
        if (snapshot) { state.bids.clear(); state.asks.clear(); }
        applyLevels(state.bids, asLevels(payload.data.b));
        applyLevels(state.asks, asLevels(payload.data.a));
        state.lastUpdateId = Number(payload.data.u) || state.lastUpdateId;
        state.updatedAt = Number(payload.cts ?? payload.ts) || Date.now();
        state.ready = true;
        state.synchronized = true;
        state.resolveReady?.();
      } catch { /* malformed updates are ignored */ }
    };
    socket.onclose = () => { if (liveBooks.get(key) === state) state.synchronized = false; };
    socket.onerror = () => { state.synchronized = false; };
    state.heartbeat = setInterval(() => {
      try { if (socket.readyState === WebSocketCtor.OPEN) socket.send(JSON.stringify({ op: "ping" })); } catch { /* retry next cycle */ }
    }, 20_000);
  } catch { state.synchronized = false; }
  return state;
}

async function bybitBook(
  symbol: string,
  quote: Quote,
  signal: AbortSignal,
  selectedPair: string,
): Promise<RawBook> {
  const pair = selectedPair;
  let fullDepthFailure = "";
  try {
    const full = await fetchJson(
      "Bybit",
      `https://api.bybit.com/v5/market/full_orderbook?category=spot&symbol=${pair}`,
      signal,
    );
    if (full.retCode === 0 && full.result?.b?.length && full.result?.a?.length) {
      return bookOf(
        asLevels(full.result.b),
        asLevels(full.result.a),
        pair,
        quote,
        "REST full orderbook 10000",
      );
    }
    if (Number(full.retCode) === 10006) throw new UpstreamError("Bybit 請求過多（10006）", 429);
    fullDepthFailure = full.retMsg || `完整訂單簿回應異常（${full.retCode ?? "無代碼"}）`;
  } catch (error) {
    if (error instanceof UpstreamError && (error.status === 418 || error.status === 429 || error.status >= 500)) throw error;
    fullDepthFailure = error instanceof Error ? error.message : "完整訂單簿無法使用";
  }
  const key = liveKey("Bybit", pair);
  const existing = liveBooks.get(key);
  if (existing?.ready && existing.synchronized && Date.now() - existing.updatedAt <= LIVE_BOOK_STALE_MS) {
    return { ...liveBook(existing, "WebSocket 1000"), fallbackReason: fullDepthFailure };
  }
  if (existing && existing.updatedAt && Date.now() - existing.updatedAt > LIVE_BOOK_STALE_MS) closeLiveState(key);
  const state = startBybitStream(pair, quote, signal);
  const data = await fetchJson(
    "Bybit",
    `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${pair}&limit=50`,
    signal,
  );
  if (data.retCode !== 0 || !data.result?.b?.length) {
    closeLiveState(key);
    throw new UnsupportedError(data.retMsg ?? "交易對不存在");
  }
  await Promise.race([state.readyPromise ?? Promise.resolve(), sleep(1200)]);
  if (state.ready && state.synchronized) return { ...liveBook(state, "WebSocket 1000"), fallbackReason: fullDepthFailure };
  return bookOf(
    asLevels(data.result.b),
    asLevels(data.result.a),
    pair,
    quote,
    "REST 50 fallback",
    { fallbackReason: fullDepthFailure },
  );
}

const loadBinanceBook = (
  symbol: string,
  quote: Quote,
  signal: AbortSignal,
  selectedPair: string,
) => binanceBook(symbol, quote, signal, selectedPair);

async function loadOkxBook(
  symbol: string,
  quote: Quote,
  signal: AbortSignal,
  selectedPair: string,
) {
  const pair = selectedPair;
  const data = await fetchJson(
    "OKX",
    `https://www.okx.com/api/v5/market/books-full?instId=${pair}&sz=5000`,
    signal,
  );
  switch (classifyOkxBookResponse(data)) {
    case "rate_limit": {
      const error = new UpstreamError(`OKX 請求過多（50011）${data.msg ? `：${data.msg}` : ""}`, 429);
      rateLimiter.recordFailure("OKX", error);
      throw error;
    }
    case "unsupported":
      throw new UnsupportedError(data.msg || `交易對不存在（OKX ${data.code}）`);
    case "upstream": {
      const error = new UpstreamError(`OKX 回應異常（${data.code || "無代碼"}）${data.msg ? `：${data.msg}` : ""}`, 502);
      rateLimiter.recordFailure("OKX", error);
      throw error;
    }
  }
  return bookOf(asLevels(data.data[0].bids), asLevels(data.data[0].asks), pair, quote, "REST books-full 5000");
}

const loadBybitBook = (
  symbol: string,
  quote: Quote,
  signal: AbortSignal,
  selectedPair: string,
) => bybitBook(symbol, quote, signal, selectedPair);

async function loadCoinbaseBook(
  symbol: string,
  quote: Quote,
  signal: AbortSignal,
  selectedPair: string,
) {
  const pair = selectedPair;
  const data = await fetchJson(
    "Coinbase",
    `https://api.exchange.coinbase.com/products/${pair}/book?level=2`,
    signal,
  );
  if (!data.bids?.length || !data.asks?.length) throw new UpstreamError("Coinbase 掛單回應為空",502);
  return bookOf(asLevels(data.bids), asLevels(data.asks), pair, quote, "REST level 2");
}

async function loadBitfinexBook(
  symbol: string,
  quote: Quote,
  signal: AbortSignal,
  selectedPair: string,
) {
  const apiPair = `t${selectedPair}`;
  const data = await fetchJson(
    "Bitfinex",
    `https://api-pub.bitfinex.com/v2/book/${apiPair}/P2?len=250`,
    signal,
  );
  if (!Array.isArray(data) || !data.length || data[0]?.[0] === "error") throw new UnsupportedError("交易對不存在");
  return bookOf(
    asLevels(data.filter((row: any[]) => Number(row[2]) > 0).map((row: any[]) => [row[0], row[2]])),
    asLevels(data.filter((row: any[]) => Number(row[2]) < 0).map((row: any[]) => [row[0], -row[2]])),
    apiPair.slice(1),
    quote,
    "REST P2 250",
  );
}

async function loadKrakenBook(
  symbol: string,
  quote: Quote,
  signal: AbortSignal,
  selectedPair: string,
  tickSize = 0,
) {
  const pair = selectedPair;
  const cached=krakenGroupings.get(pair),grouping=cached&&cached.expires>Date.now()&&cached.tick===tickSize?cached.value:1;
  const data = await fetchJson(
    "Kraken",
    `https://api.kraken.com/0/public/GroupedBook?pair=${pair}&depth=1000&grouping=${grouping}`,
    signal,
  );
  const disposition=classifyKrakenBookResponse(data);
  if(disposition==='unsupported')throw new UnsupportedError(data.error.join(', '));
  if(disposition!=='ok'){const error=new UpstreamError(data.error?.join(', ')||'Kraken 掛單回應異常',disposition==='rate_limit'?429:502);if(disposition==='rate_limit')rateLimiter.recordFailure('Kraken',error);throw error;}
  const book=bookOf(
    asLevels(data.result.bids.map((row: any) => [row.price, row.qty])),
    asLevels(data.result.asks.map((row: any) => [row.price, row.qty])),
    pair,
    quote,
    `REST GroupedBook 1000 × ${grouping} ticks`,
    {tickSize},
  );
  const mid=((book.bids[0]?.[0]??0)+(book.asks[0]?.[0]??0))/2;
  if(tickSize>0&&mid>0)krakenGroupings.set(pair,{value:krakenGrouping(mid,tickSize),tick:tickSize,expires:Date.now()+PAIR_CACHE_MS});
  return book;
}

const bookLoaders: Record<
  Exchange,
  (symbol: string, quote: Quote, signal: AbortSignal, selectedPair: string, tickSize?:number) => Promise<RawBook>
> = {
  Binance: loadBinanceBook,
  OKX: loadOkxBook,
  Bybit: loadBybitBook,
  Coinbase: loadCoinbaseBook,
  Bitfinex: loadBitfinexBook,
  Kraken: loadKrakenBook,
};

async function resolveBook(exchange: Exchange, symbol: string, signal: AbortSignal) {
  const market = await resolveFixedMarket(exchange, symbol);
  if (!market) throw new UnsupportedError("沒有可用的美元現貨交易對");
  pairCache.set(`${exchange}:${symbol}`, { value: market, expires: Date.now() + PAIR_CACHE_MS });
  const key = `${exchange}:${market.pair}`;
  let task = bookInflight.get(key);
  if (!task) {
    task = bookLoaders[exchange](symbol, market.quote, signal, market.pair, market.tickSize)
      .then(book => ({ ...book, tickSize: market.tickSize || book.tickSize }))
      .finally(() => bookInflight.delete(key));
    bookInflight.set(key, task);
  }
  return task;
}

function mergeBooks(first: RawBook, latest: RawBook): RawBook {
  const bidMap = new Map<string, number>();
  const askMap = new Map<string, number>();
  applyLevels(bidMap, first.bids);
  applyLevels(askMap, first.asks);
  applyLevels(bidMap, latest.bids);
  applyLevels(askMap, latest.asks);

  const newestBestBid = latest.bids[0]?.[0] ?? 0;
  const newestBestAsk = latest.asks[0]?.[0] ?? Number.POSITIVE_INFINITY;
  const bids = [...bidMap].map(([price, quantity]): Level => [Number(price), quantity])
    .filter(([price, quantity]) => quantity > 0 && price < newestBestAsk)
    .sort((a, b) => b[0] - a[0]);
  const asks = [...askMap].map(([price, quantity]): Level => [Number(price), quantity])
    .filter(([price, quantity]) => quantity > 0 && price > newestBestBid)
    .sort((a, b) => a[0] - b[0]);
  const mergeWindowMs = Math.max(0, latest.capturedAt - first.capturedAt);
  return {
    bids, asks, pair: latest.pair, quote: latest.quote,
    feed: `${latest.feed} / 5s merged`, capturedAt: latest.capturedAt,
    snapshotCount: first.snapshotCount + latest.snapshotCount,
    mergeWindowMs, temporalMerged: true,
    acquisitionMode: latest.acquisitionMode,
    tickSize: latest.tickSize,
    fallbackReason: latest.fallbackReason,
  };
}

function isLiveBook(book: RawBook) {
  return book.feed.toLowerCase().includes("websocket");
}

export async function bookForSource(
  exchange: Exchange,
  symbol: string,
  signal: AbortSignal,
) {
  const latest = await resolveBook(exchange, symbol, signal);
  if (isLiveBook(latest)) return latest;
  const key = `${exchange}:${symbol}:${latest.pair}`;
  const previous = recentRestBooks.get(key);
  recentRestBooks.set(key, latest);
  if (!previous || previous.pair !== latest.pair || previous.quote !== latest.quote) return latest;
  if(exchange==='Kraken'&&(previous.feed!==latest.feed||previous.tickSize!==latest.tickSize))return latest;
  const windowMs = latest.capturedAt - previous.capturedAt;
  if (windowMs <= 0 || windowMs > MERGE_WINDOW_MS) return latest;
  return mergeBooks(previous, latest);
}

function delayedMarket(exchange: Exchange, symbol: string) {
  const market = pairCache.get(`${exchange}:${symbol}`)?.value;
  return market ?? { pair: "", quote: FIXED_EXCHANGE_QUOTES[exchange] as Quote };
}

const binanceAdapter: DepthSourceAdapter = {
  exchange: "Binance",
  load: (symbol, signal) => bookForSource("Binance", symbol, signal),
  delayedMarket: (symbol) => delayedMarket("Binance", symbol),
};
const okxAdapter: DepthSourceAdapter = {
  exchange: "OKX",
  load: (symbol, signal) => bookForSource("OKX", symbol, signal),
  delayedMarket: (symbol) => delayedMarket("OKX", symbol),
};
const bybitAdapter: DepthSourceAdapter = {
  exchange: "Bybit",
  load: (symbol, signal) => bookForSource("Bybit", symbol, signal),
  delayedMarket: (symbol) => delayedMarket("Bybit", symbol),
};
const coinbaseAdapter: DepthSourceAdapter = {
  exchange: "Coinbase",
  load: (symbol, signal) => bookForSource("Coinbase", symbol, signal),
  delayedMarket: (symbol) => delayedMarket("Coinbase", symbol),
};
const bitfinexAdapter: DepthSourceAdapter = {
  exchange: "Bitfinex",
  load: (symbol, signal) => bookForSource("Bitfinex", symbol, signal),
  delayedMarket: (symbol) => delayedMarket("Bitfinex", symbol),
};
const krakenAdapter: DepthSourceAdapter = {
  exchange: "Kraken",
  load: (symbol, signal) => bookForSource("Kraken", symbol, signal),
  delayedMarket: (symbol) => delayedMarket("Kraken", symbol),
};

export const depthSourceAdapters = [
  binanceAdapter,
  okxAdapter,
  bybitAdapter,
  coinbaseAdapter,
  bitfinexAdapter,
  krakenAdapter,
] as const;

export const depthEngine = createDepthEngine({
  adapters: depthSourceAdapters,
  softDeadlineMs: SOFT_DEADLINE_MS,
  isUnsupported: (error) => error instanceof UnsupportedError,
  onSourceSummarized: (symbol, source) => {
    if (source.exchange !== "Binance" || binanceLimitFor(symbol) !== 1000 || source.status !== "partial") return;
    binanceDepthLimits.set(symbol, { value: 5000, expires: Date.now() + PAIR_CACHE_MS });
    closeSymbolLiveBooks("Binance", symbol);
  },
});

function responseCacheKey(symbol: string, exchanges: readonly Exchange[] = EXCHANGES) {
  const exchangeKey = exchanges.join(",") || "none";
  return `${symbol}:max-${MAX_TARGET_DEPTH}:sources-${exchangeKey}:binance-${binanceLimitFor(symbol)}`;
}

function pruneExpiredCaches(now = Date.now()) {
  sharedResults.prune();
  for (const [key, entry] of pairCache) if (entry.expires <= now) pairCache.delete(key);
  for (const [key, entry] of binanceDepthLimits) if (entry.expires <= now) binanceDepthLimits.delete(key);
  for (const [key, book] of recentRestBooks) if (now - book.capturedAt > MERGE_WINDOW_MS) recentRestBooks.delete(key);
}

export async function loadDepthResponse(
  symbol: string,
  selectedDepth: DepthOption,
  selectedExchanges: readonly Exchange[] = EXCHANGES,
) {
  pruneExpiredCaches();
  const key = responseCacheKey(symbol, selectedExchanges);
  const result = await sharedResults.load(
    key,
    () => depthEngine.aggregate(symbol, selectedExchanges),
    () => responseCacheKey(symbol, selectedExchanges),
  );
  const payload = responseAtDepth(result.value, selectedDepth);
  return { payload: result.cached ? { ...payload, cached: true } : payload, cached: result.cached };
}
