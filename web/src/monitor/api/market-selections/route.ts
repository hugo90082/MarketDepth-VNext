import { MARKET_EXCHANGES } from "../../market-ranking";
import { resolveFixedMarket } from "../../market-selection-server";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.toUpperCase() ?? "";
  if (!/^[A-Z0-9]{2,15}$/.test(symbol)) return Response.json({ error: "商品代碼無效" }, { status: 400 });
  const entries = await Promise.all(MARKET_EXCHANGES.map(async exchange => {
    try { return [exchange, { market: await resolveFixedMarket(exchange, symbol) }] as const; }
    catch (error) { return [exchange, { error: error instanceof Error ? error.message : "交易對暫時無法確認" }] as const; }
  }));
  return Response.json({ symbol, selections: Object.fromEntries(entries) }, { headers: { "Cache-Control": "no-store" } });
}
