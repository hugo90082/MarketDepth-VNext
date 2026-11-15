import { getMarketDirectory } from "../market-catalog";
import { type DepthOption } from "../depth-types";
import { ALLOWED_DEPTHS, EXCHANGES, loadDepthResponse, type Exchange } from "./source-runtime";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  const depth = Number(url.searchParams.get("depth") ?? 10);
  const exchangeParam = url.searchParams.get("exchanges");
  const requestedExchanges = exchangeParam
    ? [...new Set(exchangeParam.split(",").filter(Boolean))]
    : [...EXCHANGES];
  if (!/^[A-Z0-9]{2,15}$/.test(symbol)) {
    return Response.json({ error: "商品格式不正確" }, { status: 400 });
  }
  if (!ALLOWED_DEPTHS.has(depth)) {
    return Response.json({ error: "不支援的深度範圍" }, { status: 400 });
  }
  if (!requestedExchanges.length || requestedExchanges.some((exchange) => !EXCHANGES.includes(exchange as Exchange))) {
    return Response.json({ error: "交易所參數不正確" }, { status: 400 });
  }
  const directory = await getMarketDirectory();
  if (!directory.items.length) {
    return Response.json({ error: "市場目錄暫時無法使用" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!directory.items.some((item) => item.symbol === symbol)) {
    return Response.json({ error: "市場目錄未列出此商品" }, { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  }
  try {
    const { payload } = await loadDepthResponse(symbol, depth as DepthOption, requestedExchanges as Exchange[]);
    return Response.json(payload, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=3, stale-while-revalidate=2" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "聚合失敗" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
