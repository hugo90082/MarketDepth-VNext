/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAbortDeadline } from "./request-deadline.ts";
import { CATALOG_ENDPOINTS, FIXED_EXCHANGE_QUOTES, MARKET_EXCHANGES, normalizeSymbol, parseExchangeCandidates, type MarketExchange, type MarketSelection } from "./market-ranking.ts";
export { MARKET_EXCHANGES } from "./market-ranking.ts";
export type { MarketExchange, MarketQuote, MarketSelection } from "./market-ranking.ts";
export type ExchangeCatalog = { exchange: MarketExchange; markets: Map<string, MarketSelection> | null; generatedAt: number; expiresAt: number; revision: string; stale: boolean; error?: string };
export const MARKET_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
export const MARKET_CATALOG_REQUEST_TIMEOUT_MS = 8_000;
const MARKET_CATALOG_RETRY_MS = 60_000;

export function parseExchangeCatalog(exchange: MarketExchange, data: any) {
  const fixedQuote = FIXED_EXCHANGE_QUOTES[exchange];
  return new Map([...parseExchangeCandidates(exchange, data)].flatMap(([symbol, candidates]) => {
    const candidate = candidates.find(item => item.quote === fixedQuote);
    return candidate ? [[symbol, { symbol, pair: candidate.pair, quote: candidate.quote, tickSize: candidate.tickSize } satisfies MarketSelection] as const] : [];
  }));
}
async function fetchCatalogJson(exchange: MarketExchange, signal: AbortSignal, fetchImpl: typeof fetch) {
  let response: Response;
  try {
    response = await fetchImpl(CATALOG_ENDPOINTS[exchange], { headers: { Accept: "application/json", "User-Agent": "DepthWatch/4.0" }, signal });
  } catch (err) {
    if (fetchImpl !== fetch || typeof location === "undefined") throw err;
    response = await fetch(`/api/exchange-proxy?url=${encodeURIComponent(CATALOG_ENDPOINTS[exchange])}`, { headers: { Accept: "application/json" }, credentials: "same-origin", signal });
  }
  if (!response.ok) throw new Error(`市場目錄 HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error("市場目錄回應過大");
  return JSON.parse(text);
}
type Options = { fetchImpl?: typeof fetch; requestTimeoutMs?: number; now?: () => number };
export function createMarketCatalogService({ fetchImpl = fetch, requestTimeoutMs = MARKET_CATALOG_REQUEST_TIMEOUT_MS, now = Date.now }: Options = {}) {
  const cache = new Map<MarketExchange, ExchangeCatalog>();
  const inflight = new Map<MarketExchange, Promise<ExchangeCatalog>>();
  const refresh = (exchange: MarketExchange, cached?: ExchangeCatalog) => {
    const active = inflight.get(exchange); if (active) return active;
    const task = (async () => {
      try {
        const data = await withAbortDeadline(signal => fetchCatalogJson(exchange, signal, fetchImpl), requestTimeoutMs, `${exchange} 市場目錄等待逾時`);
        const markets = parseExchangeCatalog(exchange, data);
        if (!markets.size) throw new Error(`市場目錄沒有可用的 ${FIXED_EXCHANGE_QUOTES[exchange]} 現貨`);
        const generatedAt = now();
        const value: ExchangeCatalog = { exchange, markets, generatedAt, expiresAt: generatedAt + MARKET_CATALOG_TTL_MS, revision: `${exchange}:${generatedAt}`, stale: false };
        cache.set(exchange, value); return value;
      } catch (error) {
        const failedAt = now(); const message = error instanceof Error ? error.message : "市場目錄載入失敗";
        const retryMs = exchange === "Binance" && /HTTP (403|451)/.test(message) ? MARKET_CATALOG_TTL_MS : MARKET_CATALOG_RETRY_MS;
        const value: ExchangeCatalog = cached ? { ...cached, expiresAt: failedAt + retryMs, stale: true, error: message } : { exchange, markets: null, generatedAt: 0, expiresAt: failedAt + retryMs, revision: `${exchange}:unknown`, stale: true, error: message };
        cache.set(exchange, value); return value;
      }
    })().finally(() => inflight.delete(exchange));
    inflight.set(exchange, task); return task;
  };
  const loadExchangeCatalog = async (exchange: MarketExchange, requestedAt = now()) => {
    const cached = cache.get(exchange);
    if (cached && cached.expiresAt > requestedAt) return cached;
    if (cached?.markets) { void refresh(exchange, cached); return { ...cached, stale: true }; }
    return refresh(exchange, cached);
  };
  const resolveCatalogMarket = async (exchange: MarketExchange, symbol: string) => {
    const catalog = await loadExchangeCatalog(exchange);
    return { known: catalog.markets !== null, market: catalog.markets?.get(normalizeSymbol(symbol)) ?? null, revision: catalog.revision, stale: catalog.stale, error: catalog.error };
  };
  const getMarketDirectory = async () => {
    const catalogs = await Promise.all(MARKET_EXCHANGES.map(exchange => loadExchangeCatalog(exchange)));
    const union = new Map<string, { symbol: string; exchanges: MarketExchange[] }>();
    for (const catalog of catalogs) for (const symbol of catalog.markets?.keys() ?? []) { const item = union.get(symbol) ?? { symbol, exchanges: [] }; item.exchanges.push(catalog.exchange); union.set(symbol, item); }
    const generatedAt = Math.max(0, ...catalogs.map(item => item.generatedAt));
    return { generatedAt, expiresAt: generatedAt ? generatedAt + MARKET_CATALOG_TTL_MS : 0, partial: catalogs.some(item => item.stale), sources: catalogs.map(item => ({ exchange: item.exchange, status: item.markets ? item.stale ? "stale" : "ok" : "error", generatedAt: item.generatedAt, error: item.error })), items: [...union.values()].map(item => ({ ...item, sourceCount: item.exchanges.length })).sort((a, b) => a.symbol.localeCompare(b.symbol)) };
  };
  return { getMarketDirectory, loadExchangeCatalog, resolveCatalogMarket };
}
const service = createMarketCatalogService();
export const loadExchangeCatalog = service.loadExchangeCatalog;
export const resolveCatalogMarket = service.resolveCatalogMarket;
export const getMarketDirectory = service.getMarketDirectory;
