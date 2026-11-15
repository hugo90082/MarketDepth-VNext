import { resolveCatalogMarket } from "./market-catalog";
import type { MarketExchange } from "./market-ranking";

export async function resolveFixedMarket(exchange: MarketExchange, symbol: string) {
  if (exchange === "Binance" || exchange === "Bybit") {
    return { symbol, pair: `${symbol}USDT`, quote: "USDT" as const, tickSize: 0 };
  }
  if (exchange === "OKX") {
    return { symbol, pair: `${symbol}-USDT`, quote: "USDT" as const, tickSize: 0 };
  }
  if (exchange === "Coinbase") {
    const result = await resolveCatalogMarket(exchange, symbol);
    if (!result.known) throw new Error(result.error || 'Coinbase 市場目錄暫時無法使用');
    return result.market;
  }
  if (exchange === "Kraken") {
    const result = await resolveCatalogMarket(exchange, symbol);
    if(result.known)return result.market;
    // A temporary catalog failure must not prevent a known-format pair from
    // being checked by GroupedBook. Unknown precision uses one-tick grouping.
    const base = symbol === "BTC" ? "XBT" : symbol === "DOGE" ? "XDG" : symbol;
    return { symbol, pair: `${base}USD`, quote: "USD" as const, tickSize: 0 };
  }
  const result = await resolveCatalogMarket(exchange, symbol);
  if (!result.known) throw new Error(result.error || "市場目錄暫時無法使用");
  return result.market;
}
