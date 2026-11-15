/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- acquisition code is migrated without behavior changes; typed seams live in adapters.ts and source-summary.ts.
import {createRawBook} from '../depth-engine/order-book';
import {createReservationQueue} from '../../../shared/reservation-queue';
import {BinanceBookSession} from '../../../shared/binance-book';
import {bookKey,registerProfileBook,emitProfileBook,profileBookInterested} from '../../../shared/profile-books';
import { DEPTH_OPTIONS as DEPTHS, depthKey } from "../depth-types.ts";
import { createBrowserAdapterRegistry } from "./adapters.ts";
import { settleBrowserSourceTasks } from "./runtime.ts";
import { withAbortDeadline } from "../request-deadline.ts";
import {
  aggregateBrowserRange,
  emptyBrowserSource,
  sourceFromBrowserBook,
} from "./source-summary.ts";
import { getSelectedMarket } from "../market-selection-client.ts";
import {classifyKrakenBookResponse,classifyOkxBookResponse} from '../exchange-errors';
import {krakenGrouping} from '../kraken-grouping';
import { FIXED_EXCHANGE_QUOTES } from "../market-ranking.ts";
import { loadMarketMetaCandidates } from "../market-meta-adapters.ts";

const EXCHANGES = ["Binance", "OKX", "Bybit", "Coinbase", "Bitfinex", "Kraken"];
const SIX_HOURS = 6 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 16_000_000;
const BITFINEX_PRECISION = "P2";
const SOURCE_DEADLINE_MS = 30_000;
const inflight = new Map();
const negativeSupport = new Map();
const binanceLiveBooks = new Map();
let binanceProfileGeneration = 0;
let binanceRecovery;
export function setBinanceRecovery(callback) { binanceRecovery = callback; }
export function isBinanceStreamReady(symbol) {
  const state = binanceLiveBooks.get(symbol + 'USDT');
  return !!state?.ready && !state.closed && state.synchronized && Date.now() - state.updatedAt <= 60000;
}
export function stopBinanceStreams() {
  binanceRecovery = undefined;
  for (const pair of [...binanceLiveBooks.keys()]) closeBinanceLive(pair);
}
const limiter = Object.fromEntries(EXCHANGES.map((exchange) => [exchange, {
  nextAllowedAt: 0,
  blockedUntil: 0,
  failures: 0,
  lastFailureAt: 0,
}]));
const intervals = {
  Binance: 12.5,
  OKX: 250,
  Bybit: 100,
  Coinbase: 1000,
  Bitfinex: 313,
  Kraken: 1250,
};
const priorities = new WeakMap();
export const prioritizeSource = (signal) => priorities.set(signal, 1);
const reservations = Object.fromEntries(EXCHANGES.map(exchange => [exchange, createReservationQueue(limiter[exchange], () => Date.now())]));

let futuresCache = null;
const krakenGroupingCache = new Map();
const bitfinexPrepared = new Map();
let preparationGeneration = 0;
export async function prepareCoreSources(target) {
  const generation = preparationGeneration;
  for (const exchange of EXCHANGES) {
    limiter[exchange].priorityAt = target - 1500;
    limiter[exchange].priorityUntil = target + 1500;
  }
  await Promise.allSettled(['BTC', 'ETH', 'SOL'].map(async symbol => {
    const market = await getSelectedMarket('Bitfinex', symbol);
    if (!market || generation !== preparationGeneration) return;
    const pair = `t${market.pair}`;
    if (bitfinexPrepared.has(pair)) return;
    const socket = new WebSocket('wss://api-pub.bitfinex.com/ws/2');
    const entry = {socket, timer: setTimeout(() => { if (bitfinexPrepared.get(pair) === entry) {bitfinexPrepared.delete(pair); socket.close();} }, 15000)};
    bitfinexPrepared.set(pair, entry);
    const invalidate = () => {if(bitfinexPrepared.get(pair)===entry){clearTimeout(entry.timer);bitfinexPrepared.delete(pair);}};
    socket.onclose = invalidate;
    socket.onerror = () => {invalidate(); socket.close();};
  }));
}
export function stopPreparedSources() {
  preparationGeneration++;
  for (const entry of bitfinexPrepared.values()) {clearTimeout(entry.timer); entry.socket.close();}
  bitfinexPrepared.clear();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const abortError = () => {
  const error = new Error("請求已取消");
  error.name = "AbortError";
  return error;
};
const sleepWithSignal = async (ms, signal) => {
  if (!signal) return sleep(ms);
  if (signal.aborted) throw abortError();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(ms), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
};
const weightForBinance = (limit) => limit <= 100 ? 5 : limit <= 500 ? 25 : limit <= 1000 ? 50 : 250;
function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function reserve(exchange, weight = 1, signal) {
  if (signal?.aborted) throw abortError();
  const state = limiter[exchange];
  const interval = exchange === "Binance"
    ? Math.ceil(12.5 * weight)
    : intervals[exchange];
  return reservations[exchange](interval, priorities.get(signal) || 0, signal);
}

function registerFailure(exchange, response) {
  if (response.status !== 418 && response.status !== 429 && response.status < 500) return;
  const state = limiter[exchange];
  state.failures = Math.min(5, state.failures + 1);
  state.lastFailureAt = Date.now();
  const retryAfter = parseRetryAfter(response.headers?.get?.("retry-after") ?? null);
  const fallback = exchange === "Coinbase" && response.status === 429
    ? Math.min(300000, 30000 * 2 ** (state.failures - 1))
    : Math.min(60000, 1000 * 2 ** (state.failures - 1));
  state.blockedUntil = Math.max(state.blockedUntil, Date.now() + (retryAfter || fallback));
  state.nextAllowedAt = Math.max(state.nextAllowedAt, state.blockedUntil);
}

function registerSuccess(exchange, state) {
  if (exchange !== "Coinbase" || Date.now() - state.lastFailureAt >= 5 * 60 * 1000) {
    state.failures = 0;
    state.lastFailureAt = 0;
  }
  state.blockedUntil = 0;
}

function errorWithStatus(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function fetchJson(exchange, url, weight = 1, signal) {
  if (typeof weight !== "number") {
    signal = weight;
    weight = 1;
  }
  const state = await reserve(exchange, weight, signal);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw errorWithStatus(error instanceof Error ? error.message : "瀏覽器跨來源連線失敗", 0);
  }
  if (!response.ok) {
    registerFailure(exchange, response);
    const message = response.status === 429
      ? "請求過多（429）"
      : response.status === 418
        ? "IP 暫時封鎖（418）"
        : `HTTP ${response.status}`;
    const error=errorWithStatus(message,response.status);error.upstreamHttp=true;throw error;
  }
  const size = Number(response.headers.get("content-length") || 0);
  if (size > MAX_RESPONSE_BYTES) throw errorWithStatus("上游回應過大", 502);
  const text = await response.text();
  if(signal?.aborted)throw abortError();
  if (text.length > MAX_RESPONSE_BYTES) throw errorWithStatus("上游回應過大", 502);
  registerSuccess(exchange, state);
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithStatus("上游回應不是有效 JSON", 502);
  }
}

function levels(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => Array.isArray(item) ? [Number(item[0]), Number(item[1])] : [0, 0])
    .filter(([price, quantity]) => Number.isFinite(price) && Number.isFinite(quantity) && price > 0 && quantity > 0);
}

function sortedBook(bids, asks, tickSize = 0) {
  return {
    bids: levels(bids).sort((a, b) => b[0] - a[0]),
    asks: levels(asks).sort((a, b) => a[0] - b[0]),
    tickSize: Number(tickSize) || 0,
  };
}

function priceKey(price) {
  return Number(price).toFixed(12).replace(/\.?0+$/, "");
}

function applyLevelUpdates(target, raw) {
  for (const item of Array.isArray(raw) ? raw : []) {
    const price = Number(item?.[0]);
    const quantity = Number(item?.[1]);
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0) continue;
    const key = priceKey(price);
    if (quantity === 0) target.delete(key);
    else target.set(key, quantity);
  }
}

function closeBinanceLive(pair) {
  const state = binanceLiveBooks.get(pair);
  if (!state) return;
  state.closed = true;
  state.synchronized = false;
  emitProfileBook({key:bookKey('binance',pair.replace(/USDT$/,'')),type:'status'});
  state.refreshController?.abort();
  state.session.reset();
  binanceLiveBooks.delete(pair);
  state.detachAbort?.();
  try { state.socket?.close(); } catch { /* connection may already be closed */ }
}

function invalidateBinance(state, reason) {
  if (state.closed || binanceLiveBooks.get(state.pair) !== state) return;
  closeBinanceLive(state.pair);
  binanceRecovery?.(state.pair, reason);
}

function applyBinanceDiff(state, event) {
  if (state.closed || binanceLiveBooks.get(state.pair) !== state) return false;
  const first = Number(event.U);
  const last = Number(event.u);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last) return false;
  if (last <= state.lastUpdateId) return true;
  if (first > state.lastUpdateId + 1) return false;
  const wasSynchronized=state.synchronized;
  const patches=[],interested=profileBookInterested(bookKey('binance',state.pair.replace(/USDT$/,'')));
  if(interested)for(const [side,entries,map]of [['bid',event.b,state.bids],['ask',event.a,state.asks]])for(const [p,q]of entries??[]){const price=Number(p),qty=Number(q);if(Number.isFinite(price)&&price>0&&Number.isFinite(qty)&&qty>=0)patches.push({side,price,old:map.get(price)??0,qty});}
  try { state.session.receive(event, Date.now()); } catch { return false; }
  syncBinanceState(state);
  state.lastMessageAt = Date.now();
  state.synchronized = true;
  // Read final values after sequence validation; duplicate prices in one diff
  // are collapsed so replacement quantities cannot be counted twice.
  const accepted=new Map();for(const p of patches){const key=p.side+':'+p.price;if(!accepted.has(key))accepted.set(key,{...p,qty:(p.side==='bid'?state.bids:state.asks).get(p.price)??0});}
  if(interested)emitProfileBook({key:bookKey('binance',state.pair.replace(/USDT$/,'')),type:wasSynchronized?'patch':'reset',patches:[...accepted.values()]});
  return true;
}

function syncBinanceState(state) {
  const book = state.session.book;
  state.bids = book.bids;
  state.asks = book.asks;
  state.lastUpdateId = book.id;
  state.updatedAt = book.at;
  state.ready = book.ready;
}

function refreshBinanceLive(state) {
  if (state.refreshTask || state.closed || Date.now() < (state.refreshRetryAt || 0) || !state.session.needsRefresh(Date.now())) return;
  if (!state.session.begin(Date.now())) return;
  const controller = new AbortController();
  state.refreshController = controller;
  const startedId = state.lastUpdateId;
  const timer = setTimeout(() => controller.abort(), SOURCE_DEADLINE_MS);
  state.refreshBuffer = [];
  state.refreshTask = (async () => {
    try {
      let data;
      for (;;) {
        data = await fetchJson('Binance', `https://data-api.binance.vision/api/v3/depth?symbol=${state.pair}&limit=${state.limit}`, weightForBinance(state.limit), controller.signal);
        if (state.closed || binanceLiveBooks.get(state.pair) !== state) return;
        const first = state.refreshBuffer[0];
        if (Number(data.lastUpdateId) >= startedId && (!first || Number(data.lastUpdateId) + 1 >= Number(first.U))) break;
      }
      const bids = levels(data.bids), asks = levels(data.asks);
      if (!Number.isSafeInteger(Number(data.lastUpdateId)) || !bids.length || !asks.length) throw new Error('Binance 補快照格式異常');
      state.session.install(data, Date.now());
      syncBinanceState(state);
      // Sequence-continuous refresh preserves observed outer levels. Only
      // REST intervals expand the boundary whose contents are fully known.
      const nextBounds = {bid: Math.min(...bids.map(([p]) => p)), ask: Math.max(...asks.map(([p]) => p))};
      const previousBounds = state.verifiedBounds;
      state.verifiedBounds = nextBounds.bid <= previousBounds.ask && nextBounds.ask >= previousBounds.bid
        ? {bid: Math.min(previousBounds.bid, nextBounds.bid), ask: Math.max(previousBounds.ask, nextBounds.ask)} : nextBounds;
      state.snapshotAt = state.session.lastSnapshotAt;
      state.profileGeneration = ++binanceProfileGeneration;
      emitProfileBook({key:bookKey('binance',state.pair.replace(/USDT$/,'')),type:'reset',continuous:true});
      state.refreshRetryAt = 0;
    } catch {
      // A failed refresh must not discard the healthy, sequenced live book.
      state.session.cancel();
      state.refreshRetryAt = Date.now() + 60_000;
    } finally {
      clearTimeout(timer);
      state.refreshTask = null;
      state.refreshController = null;
      state.refreshBuffer = [];
    }
  })();
}

function startBinanceLive(pair, quote, limit, tickSize, signal) {
  closeBinanceLive(pair);
  const state = {
    pair,
    quote,
    limit,
    tickSize,
    bids: new Map(),
    asks: new Map(),
    lastUpdateId: 0,
    updatedAt: 0,
    ready: false,
    closed: false,
    synchronized: false,
    profileGeneration: ++binanceProfileGeneration,
    buffer: [],
    socket: null,
    session: new BinanceBookSession(),
  };
  state.session.begin();
  binanceLiveBooks.set(pair, state);
  registerProfileBook(bookKey('binance',pair.replace(/USDT$/,'')),()=>({bids:state.bids,asks:state.asks,ready:state.ready&&state.synchronized&&!state.closed&&binanceLiveBooks.get(pair)===state,activityAt:state.lastMessageAt??0,updateAt:state.updatedAt,snapshotAt:state.snapshotAt??0,tick:state.tickSize,bounds:state.verifiedBounds,complete:false,generation:state.profileGeneration}));
  const onAbort=()=>{if(binanceLiveBooks.get(pair)===state)closeBinanceLive(pair);};
  state.detachAbort=()=>signal?.removeEventListener('abort',onAbort);
  signal?.addEventListener('abort',onAbort,{once:true});
  try {
    const socket = new WebSocket(`wss://data-stream.binance.vision/ws/${pair.toLowerCase()}@depth@100ms`);
    state.socket = socket;
    socket.onmessage = (message) => {
      if (state.closed || binanceLiveBooks.get(pair) !== state) return;
      try {
        const event = JSON.parse(String(message.data));
        if (event.e !== "depthUpdate") return;
        if (!state.ready) {
          if (state.buffer.length >= 4096) throw new Error('Binance 初始化增量緩衝已滿');
          state.buffer.push(event);
          return;
        }
        if (state.refreshTask) state.refreshBuffer.push(event);
        if (!applyBinanceDiff(state, event)) invalidateBinance(state, '增量序號缺口');
      } catch {
        invalidateBinance(state, '增量格式異常');
      }
    };
    socket.onerror = () => invalidateBinance(state, '串流連線失敗');
    socket.onclose = () => invalidateBinance(state, '串流已關閉');
  } catch {
    state.synchronized = false;
  }
  return state;
}

function bookFromBinanceLive(state) {
  return {
    bids: [...state.bids].map(([price, quantity]) => [Number(price), quantity]).sort((a, b) => b[0] - a[0]),
    asks: [...state.asks].map(([price, quantity]) => [Number(price), quantity]).sort((a, b) => a[0] - b[0]),
    tickSize: state.tickSize,
    verifiedBounds: state.verifiedBounds,
    lastMessageAt: state.lastMessageAt,
    snapshotAt: state.snapshotAt,
    coverageMode: state.synchronized ? 'sequenced-diff' : undefined,
  };
}


function sourceFromBook(exchange, pair, quote, book, started, feed, metadata = {}) {
 const source = sourceFromBrowserBook(exchange, pair, quote, book, started, feed, metadata);
 return {...source, rawBook: createRawBook({...book, pair, quote, feed, capturedAt: metadata.capturedAt ?? source.time, acquisitionMode: metadata.acquisitionMode || 'official-api'})};
}
const emptySource = emptyBrowserSource;

function supportKey(exchange, symbol) {
  return `${exchange}:${symbol}`;
}

function cacheUnsupported(exchange, symbol) {
  negativeSupport.set(supportKey(exchange, symbol), { expires: Date.now() + SIX_HOURS });
}

function clearUnsupported(exchange, symbol) {
  negativeSupport.delete(supportKey(exchange, symbol));
}

async function withSelectedMarket(exchange, symbol, fetchCandidate) {
  const market = await getSelectedMarket(exchange, symbol);
  if (!market) return emptySource(exchange, "USD", "unsupported", "沒有可用的美元現貨交易對");
  return fetchCandidate(market.quote, market);
}

async function fetchBinance(symbol, limit, signal) {
  const started = Date.now();
  const market = await getSelectedMarket("Binance", symbol);
  if (!market) return { source: emptySource("Binance", "USD", "unsupported", "沒有可用的美元現貨交易對"), nextLimit: limit };
  const candidates = [market];
  for (const candidate of candidates) {
    try {
      const live = binanceLiveBooks.get(candidate.pair);
      if (live?.ready && !live.closed && live.limit >= limit && Date.now() - live.updatedAt <= 60_000) {
        // Sampling reads immediately; background REST refresh never owns or
        // closes the persistent Diff socket and never stalls the 30s round.
        refreshBinanceLive(live);
        const source = sourceFromBook(
          "Binance",
          candidate.pair,
          candidate.quote,
          bookFromBinanceLive(live),
          started,
          `瀏覽器直連 Binance REST ${live.limit}${live.synchronized ? " + Diff WebSocket" : ""}`,
          { acquisitionMode: live.synchronized ? "web-feed" : "official-api", capturedAt: live.synchronized ? Date.now() : live.snapshotAt, lastMessageAt: live.lastMessageAt, verifiedBounds: live.verifiedBounds },
        );
        return {
          source,
          nextLimit: limit === 1000 && source.ranges["10"].status === "partial" ? 5000 : limit,
        };
      }
      if (live) closeBinanceLive(candidate.pair);
      const state = startBinanceLive(
        candidate.pair,
        candidate.quote,
        limit,
        candidate.tickSize,
        signal,
      );
      let data;
      for (;;) {
       data = await fetchJson(
        "Binance",
        `https://data-api.binance.vision/api/v3/depth?symbol=${candidate.pair}&limit=${limit}`,
        weightForBinance(limit),
        signal,
       );
       if (state.closed || binanceLiveBooks.get(candidate.pair) !== state) throw new Error('Binance 初始化連線已失效');
       if (!Number.isSafeInteger(Number(data.lastUpdateId)) || !levels(data.bids).length || !levels(data.asks).length) throw new Error('Binance 快照格式異常');
       const first = state.buffer[0];
       if (!first || Number(data.lastUpdateId) >= Number(first.U)) break;
       // Keep buffering the same stream while a newer REST snapshot catches up.
      }
      state.session.install(data, Date.now());
      syncBinanceState(state);
      state.snapshotAt = state.updatedAt;
      const initialBook = bookFromBinanceLive(state);
      state.verifiedBounds = {bid: initialBook.bids.at(-1)[0], ask: initialBook.asks.at(-1)[0]};
      state.ready = true;
      const buffered = state.buffer.splice(0).filter((event) => Number(event.u) > state.lastUpdateId);
      const firstApplicable = buffered.findIndex((event) => (
        Number(event.U) <= state.lastUpdateId + 1 && Number(event.u) >= state.lastUpdateId + 1
      ));
      if (firstApplicable >= 0) {
        state.synchronized = buffered.slice(firstApplicable).every((event) => applyBinanceDiff(state, event));
        if (!state.synchronized) throw new Error('Binance 快照增量接續失敗');
      } else if (buffered.length) {
        throw new Error('Binance 快照缺少接續增量');
      }
      const book = bookFromBinanceLive(state);
      state.profileGeneration = ++binanceProfileGeneration;
      emitProfileBook({key:bookKey('binance',state.pair.replace(/USDT$/,'')),type:'reset'});
      const source = sourceFromBook(
        "Binance",
        candidate.pair,
        candidate.quote,
        book,
        started,
        `瀏覽器直連 Binance REST ${limit}${state.synchronized ? " + Diff WebSocket" : ""}`,
        { acquisitionMode: state.synchronized ? "web-feed" : "official-api", capturedAt: Date.now(), lastMessageAt: state.lastMessageAt, verifiedBounds: state.verifiedBounds },
      );
      // The request deadline owns bootstrap only. A healthy increment stream
      // belongs to the collector and remains open across subsequent rounds.
      state.detachAbort();
      return {
        source,
        nextLimit: limit === 1000 && source.ranges["10"].status === "partial" ? 5000 : limit,
      };
    } catch (error) {
      closeBinanceLive(candidate.pair);
      if (error.status === 400 || error.status === 404) {
        cacheUnsupported("Binance", symbol);
        return { source: emptySource("Binance", "USDT", "unsupported", "交易對不存在"), nextLimit: limit };
      }
      throw error;
    }
  }
  return { source: emptySource("Binance", "USDT", "unsupported", "交易對不存在"), nextLimit: limit };
}

async function fetchOkx(symbol, signal) {
  return withSelectedMarket("OKX", symbol, async (quote, market) => {
    const started = Date.now();
    const pair = market.pair;
    const data = await fetchJson(
      "OKX",
      `https://www.okx.com/api/v5/market/books-full?instId=${pair}&sz=5000`,
      signal,
    );
    const disposition=classifyOkxBookResponse(data);
    if(disposition==='rate_limit'){registerFailure('OKX',{status:429});throw errorWithStatus('OKX 請求過多（50011）',429);}
    if(disposition==='unsupported')throw errorWithStatus(data.msg||'交易對不存在',404);
    if(disposition!=='ok'||!data.data?.[0]?.bids?.length||!data.data?.[0]?.asks?.length)throw errorWithStatus(data.msg||'OKX 掛單回應異常',502);
    return sourceFromBook(
      "OKX",
      pair,
      quote,
      sortedBook(data.data[0].bids, data.data[0].asks),
      started,
      "瀏覽器直連 OKX books-full 5000",
      { acquisitionMode: "official-api", fallbackReason: "交易頁 books/books5 深度不足，使用 books-full" },
    );
  });
}

async function bybitSnapshot(pair, signal) {
  await reserve("Bybit", 1, signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket("wss://stream.bybit.com/v5/public/spot");
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try { socket.close(); } catch { /* already closed */ }
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, errorWithStatus("Bybit WebSocket 等待超過 7 秒", 0)), 7000);
    const onAbort = () => finish(reject, abortError());
    signal?.addEventListener('abort', onAbort, {once:true});
    socket.onopen = () => socket.send(JSON.stringify({ op: "subscribe", args: [`orderbook.1000.${pair}`] }));
    socket.onerror = () => finish(reject, errorWithStatus("Bybit WebSocket 連線失敗", 0));
    socket.onclose = () => finish(reject, errorWithStatus('Bybit 訂閱完成前斷線', 0));
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data));
        if (payload.success === false) {
          finish(reject, errorWithStatus(payload.ret_msg || "Bybit 訂閱失敗", 404));
          return;
        }
        if (payload.topic !== `orderbook.1000.${pair}` || payload.type !== "snapshot") return;
        if (!payload.data?.b?.length || !payload.data?.a?.length) {
          finish(reject, errorWithStatus("Bybit 訂單簿為空", 404));
          return;
        }
        finish(resolve, payload.data);
      } catch {
        // Ignore heartbeat frames while waiting for the initial snapshot.
      }
    };
  });
}

async function fetchBybit(symbol, signal) {
  return withSelectedMarket("Bybit", symbol, async (quote, market) => {
    const started = Date.now();
    const pair = market.pair;
    let fullFailure = "";
    try {
      const full = await fetchJson(
        "Bybit",
        `https://api.bybit.com/v5/market/full_orderbook?category=spot&symbol=${pair}`,
        signal,
      );
      if (full.retCode === 0 && full.result?.b?.length && full.result?.a?.length) {
        return sourceFromBook(
          "Bybit",
          pair,
          quote,
          sortedBook(full.result.b, full.result.a),
          started,
          "瀏覽器直連 Bybit full orderbook 10000",
        );
      }
      if (Number(full.retCode) === 10006) throw errorWithStatus("Bybit 請求過多（10006）", 429);
      fullFailure = full.retMsg || "完整訂單簿回應異常";
    } catch (error) {
      if (error.status === 418 || error.status === 429 || error.status >= 500) throw error;
      fullFailure = error.message || "完整訂單簿無法使用";
    }
    try {
      const snapshot = await bybitSnapshot(pair, signal);
      return sourceFromBook(
        "Bybit",
        pair,
        quote,
        sortedBook(snapshot.b, snapshot.a),
        started,
        "瀏覽器直連 Bybit WebSocket 1000",
        { acquisitionMode: "web-feed", fallbackReason: fullFailure },
      );
    } catch (webSocketError) {
      const data = await fetchJson(
        "Bybit",
        `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${pair}&limit=1000`,
        signal,
      );
      if (data.retCode !== 0 || !data.result?.b?.length || !data.result?.a?.length) {
        if (Number(data.retCode) === 10006) throw errorWithStatus("Bybit 請求過多（10006）", 429);
        throw errorWithStatus(data.retMsg || "交易對不存在", 404);
      }
      return sourceFromBook(
        "Bybit",
        pair,
        quote,
        sortedBook(data.result.b, data.result.a),
        started,
        "瀏覽器直連 Bybit REST 1000",
        { fallbackReason: `${fullFailure}；${webSocketError instanceof Error ? webSocketError.message : "WebSocket 無法使用"}` },
      );
    }
  });
}

async function fetchCoinbase(symbol, signal) {
  return withSelectedMarket("Coinbase", symbol, async (quote, market) => {
    const started = Date.now();
    const pair = market.pair;
    const data = await fetchJson(
      "Coinbase",
      `https://api.exchange.coinbase.com/products/${pair}/book?level=2`,
      signal,
    );
    if (!data.bids?.length || !data.asks?.length) throw errorWithStatus("Coinbase 掛單回應為空", 502);
    return sourceFromBook(
      "Coinbase",
      pair,
      quote,
      sortedBook(data.bids, data.asks),
      started,
      "瀏覽器直連 Coinbase REST level 2",
    );
  });
}

async function bitfinexSnapshot(
  pair,
  signal,
  precision = BITFINEX_PRECISION,
) {
  await reserve("Bitfinex", 1, signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const prepared = bitfinexPrepared.get(pair);
    if (prepared) {clearTimeout(prepared.timer); bitfinexPrepared.delete(pair);}
    const socket = prepared?.socket ?? new WebSocket("wss://api-pub.bitfinex.com/ws/2");
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try { socket.close(); } catch { /* already closed */ }
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, errorWithStatus("Bitfinex WebSocket 等待超過 7 秒", 0)), 7000);
    const onAbort = () => finish(reject, abortError());
    signal?.addEventListener('abort', onAbort, {once:true});
    socket.onopen = () => socket.send(JSON.stringify({
      event: "subscribe",
      channel: "book",
      symbol: pair,
      prec: precision,
      freq: "F0",
      len: "250",
    }));
    socket.onerror = () => finish(reject, errorWithStatus("Bitfinex WebSocket 連線失敗", 0));
    socket.onclose = () => finish(reject, errorWithStatus('Bitfinex 訂閱完成前斷線', 0));
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data));
        if (payload?.event === "error") {
          const unsupported = /symbol|pair|unknown/i.test(payload.msg || "");
          finish(reject, errorWithStatus(payload.msg || "Bitfinex 訂閱失敗", unsupported ? 404 : 502));
          return;
        }
        if (!Array.isArray(payload) || !Array.isArray(payload[1]) || !Array.isArray(payload[1][0])) return;
        finish(resolve, payload[1]);
      } catch {
        // Ignore heartbeats and malformed messages while waiting for the snapshot.
      }
    };
    if (socket.readyState === WebSocket.OPEN) socket.onopen();
    else if (socket.readyState >= WebSocket.CLOSING) finish(reject, errorWithStatus('Bitfinex 預備連線已關閉', 0));
  });
}

async function fetchBitfinex(symbol, signal) {
  return withSelectedMarket("Bitfinex", symbol, async (quote, market) => {
    const started = Date.now();
    const apiPair = `t${market.pair}`;
    const rows = await bitfinexSnapshot(
      apiPair,
      signal,
      BITFINEX_PRECISION,
    );
    const bids = rows.filter((row) => Number(row[2]) > 0).map((row) => [row[0], row[2]]);
    const asks = rows.filter((row) => Number(row[2]) < 0).map((row) => [row[0], -Number(row[2])]);
    if (!bids.length || !asks.length) throw errorWithStatus("Bitfinex 掛單回應為空", 502);
    return sourceFromBook(
      "Bitfinex",
      apiPair.slice(1),
      quote,
      sortedBook(bids, asks),
      started,
      `瀏覽器直連 Bitfinex WebSocket ${BITFINEX_PRECISION} 250`,
      { acquisitionMode: "web-feed" },
    );
  });
}


async function fetchKraken(symbol, signal) {
  const market = await getSelectedMarket("Kraken", symbol);
  if (!market) {
    cacheUnsupported("Kraken", symbol);
    return emptySource("Kraken", FIXED_EXCHANGE_QUOTES.Kraken, "unsupported", "交易對不存在（Kraken 市場目錄已確認）");
  }
  const candidates = [market];
  for (const candidate of candidates) {
    const started = Date.now();
    try {
      const groupingEntry = krakenGroupingCache.get(candidate.pair);
      const grouping = groupingEntry?.expires > Date.now() && groupingEntry.tick === candidate.tickSize ? groupingEntry.value : 1;
      const data = await fetchJson(
        "Kraken",
        `https://api.kraken.com/0/public/GroupedBook?pair=${candidate.pair}&depth=1000&grouping=${grouping}`,
        signal,
      );
      const disposition=classifyKrakenBookResponse(data);
      if(disposition==='rate_limit')registerFailure('Kraken',{status:429});
      if(disposition!=='ok')throw errorWithStatus(data.error?.flat?.().join(', ')||'Kraken 掛單回應異常',disposition==='unsupported'?404:disposition==='rate_limit'?429:502);
      const book = sortedBook(
        data.result.bids.map((row) => [row.price, row.qty]),
        data.result.asks.map((row) => [row.price, row.qty]),
        candidate.tickSize,
      );
      if (candidate.tickSize > 0) {
        const mid = ((book.bids[0]?.[0] || 0) + (book.asks[0]?.[0] || 0)) / 2;
        krakenGroupingCache.set(candidate.pair, {
          value: krakenGrouping(mid,candidate.tickSize),
          tick: candidate.tickSize,
          expires: Date.now() + SIX_HOURS,
        });
      }
      return sourceFromBook(
        "Kraken",
        candidate.pair,
        candidate.quote,
        book,
        started,
        `瀏覽器直連 Kraken GroupedBook 1000 × ${grouping} ticks`,
        { acquisitionMode: "web-feed" },
      );
    } catch (error) {
      if (!error.upstreamHttp && (error.status === 400 || error.status === 404)) {
        cacheUnsupported("Kraken", symbol);
        return emptySource("Kraken", FIXED_EXCHANGE_QUOTES.Kraken, "unsupported", "交易對不存在");
      }
      throw error;
    }
  }
  return emptySource("Kraken", FIXED_EXCHANGE_QUOTES.Kraken, "unsupported", "交易對不存在");
}

const browserDepthAdapters = createBrowserAdapterRegistry({
  Binance: fetchBinance,
  OKX: async (symbol, binanceLimit, signal) => ({ source: await fetchOkx(symbol, signal), nextLimit: binanceLimit }),
  Bybit: async (symbol, binanceLimit, signal) => ({ source: await fetchBybit(symbol, signal), nextLimit: binanceLimit }),
  Coinbase: async (symbol, binanceLimit, signal) => ({ source: await fetchCoinbase(symbol, signal), nextLimit: binanceLimit }),
  Bitfinex: async (symbol, binanceLimit, signal) => ({ source: await fetchBitfinex(symbol, signal), nextLimit: binanceLimit }),
  Kraken: async (symbol, binanceLimit, signal) => ({ source: await fetchKraken(symbol, signal), nextLimit: binanceLimit }),
});

async function fetchSource(exchange, symbol, binanceLimit, signal) {
  const adapter = browserDepthAdapters.get(exchange);
  if (!adapter) throw new Error("不支援的瀏覽器資料來源");
  return adapter.load(symbol, binanceLimit, signal);
}

async function fetchAggregate(symbol, binanceLimit, knownExchanges = [], supportedExchanges = []) {
  let nextLimit = binanceLimit;
  const known = new Set(knownExchanges);
  const supported = new Set(supportedExchanges);
  const sources = await settleBrowserSourceTasks(
    EXCHANGES.map((exchange) => ({
      exchange,
      load: async (signal) => {
        if (known.has(exchange) && !supported.has(exchange)) {
          cacheUnsupported(exchange, symbol);
          return emptySource(
            exchange,
            FIXED_EXCHANGE_QUOTES[exchange],
            "unsupported",
            "市場目錄確認無此交易對",
          );
        }
        if (known.has(exchange) && supported.has(exchange)) clearUnsupported(exchange, symbol);
        const result = await fetchSource(exchange, symbol, binanceLimit, signal);
        if (exchange === "Binance") nextLimit = result.nextLimit;
        return result.source;
      },
      delayed: () => emptySource(
        exchange,
        FIXED_EXCHANGE_QUOTES[exchange],
        "delayed",
        "等待超過 30 秒，本輪未納入",
      ),
      failed: (error) => emptySource(
        exchange,
        FIXED_EXCHANGE_QUOTES[exchange],
        error?.status === 400 || error?.status === 404 ? "unsupported" : "error",
        error instanceof Error ? error.message : "瀏覽器直連失敗",
      ),
    })),
    SOURCE_DEADLINE_MS,
  );
  const ranges = Object.fromEntries(DEPTHS.map((depth) => [depthKey(depth), aggregateBrowserRange(sources, depth)]));
  return {
    payload: {
      symbol,
      depth: 10,
      sources,
      ranges,
      ...ranges["10"],
      binancePerp: false,
      generatedAt: Date.now(),
    },
    nextLimit,
  };
}

async function loadFutures() {
  if (futuresCache && futuresCache.expires > Date.now()) return futuresCache.symbols;
  const response = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo", {
    headers: { Accept: "application/json" },
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Binance Futures HTTP ${response.status}`);
  const data = await response.json();
  const symbols = (data.symbols || [])
    .filter((item) => item.contractType === "PERPETUAL" && item.status === "TRADING" && item.quoteAsset === "USDT")
    .map((item) => item.symbol);
  futuresCache = { symbols, expires: Date.now() + SIX_HOURS };
  return symbols;
}


export {fetchSource as loadBrowserSource, fetchAggregate, loadFutures};
 export async function handleFormalRequest(message) {
  if(message.type === 'futures') return {ok:true,symbols:await loadFutures()};
  if(message.type === 'market-meta') return {ok:true,result:await loadMarketMetaCandidates(message.symbols)};
  throw new Error('不支援的行情操作');
 }
