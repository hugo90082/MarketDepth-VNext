import type { MarketExchange, MarketSelection } from "./market-ranking.ts";
import { resolveFixedMarket } from "./market-selection-server.ts";
import { withAbortDeadline } from "./request-deadline.ts";

type Entry = { market?: MarketSelection | null; error?: string };
const defaultFetcher: typeof fetch = (...args) => fetch(...args);
export function createMarketSelectionClient(fetcher: typeof fetch = defaultFetcher) {
  const saved = new Map<string, {market:MarketSelection|null;expires:number}>();
  const pending = new Map<string, Promise<Record<string, Entry>>>();
  return async (exchange: MarketExchange, symbol: string) => {
    const key = `${exchange}:${symbol}`;
    const cached = saved.get(key);
    if (cached&&cached.expires>Date.now()) return cached.market;
    if (fetcher === defaultFetcher) {
      const market = await withAbortDeadline(async () => resolveFixedMarket(exchange, symbol), 12000, "網站交易對確認逾時");
      saved.set(key, { market, expires: Date.now() + 6 * 60 * 60 * 1000 });
      return market;
    }
    let task = pending.get(symbol);
    if (!task) {
      task = withAbortDeadline(async signal => {
        const response = await fetcher(`/api/market-selections?symbol=${encodeURIComponent(symbol)}`, { signal, credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(`網站交易對確認失敗（${response.status}）`);
        const payload = await response.json() as {symbol:string;selections:Record<string,Entry>};
        if (payload.symbol !== symbol || !payload.selections) throw new Error("網站交易對回應異常");
        for (const [venue, entry] of Object.entries(payload.selections) as [string, Entry][]) {
          if (entry.market||entry.market===null&&!entry.error) saved.set(`${venue}:${symbol}`, {market:entry.market,expires:Date.now()+6*60*60*1000});
        }
        return payload.selections as Record<string, Entry>;
      }, 12000, "網站交易對確認逾時").finally(() => pending.delete(symbol));
      pending.set(symbol, task);
    }
    const entry = (await task)[exchange];
    if (!entry || entry.error) throw new Error(entry?.error || "網站尚未確認此交易對");
    return entry.market ?? null;
  };
}
export const getSelectedMarket = createMarketSelectionClient();
