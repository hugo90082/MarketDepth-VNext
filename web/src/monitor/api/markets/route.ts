import { getMarketDirectory } from "../../market-catalog";

export async function GET() {
  const directory = await getMarketDirectory();
  if (!directory.items.length) {
    return Response.json({ ...directory, error: "暫時無法取得市場目錄" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(directory, { headers: { "Cache-Control": "private, max-age=300" } });
}

