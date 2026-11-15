import { getMarketDirectory } from "./market-catalog.ts";
import { loadMarketMetaCandidates } from "./market-meta-adapters.ts";
import { type MarketMetaBatchResponse } from "./market-meta.ts";

type Directory = Awaited<ReturnType<typeof getMarketDirectory>>;
type Dependencies = {
  directory?: () => Promise<Directory>;
  load?: (symbols: readonly string[]) => Promise<MarketMetaBatchResponse>;
};

const CACHE_MS = 3_000;
const responseCache = new Map<string, {
  expiresAt: number;
  payload: MarketMetaBatchResponse;
}>();
const inflight = new Map<string, Promise<MarketMetaBatchResponse>>();

function parseSymbols(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = [...new Set(
    raw.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
  )];
  if (
    symbols.length === 0
    || symbols.length > 20
    || symbols.some((symbol) => !/^[A-Z0-9]{2,15}$/.test(symbol))
  ) {
    return null;
  }
  return symbols;
}

async function loadShared(
  symbols: readonly string[],
  load: (symbols: readonly string[]) => Promise<MarketMetaBatchResponse>,
) {
  const key = [...symbols].sort().join(",");
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const running = inflight.get(key);
  if (running) return running;
  const task = load(symbols)
    .then((payload) => {
      responseCache.set(key, {
        payload,
        expiresAt: Date.now() + CACHE_MS,
      });
      return payload;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

export async function handleMarketMetaRequest(
  request: Request,
  dependencies: Dependencies = {},
) {
  const symbols = parseSymbols(request);
  if (!symbols) {
    return Response.json(
      { error: "symbols 必須包含 1～20 個大寫英數商品代號" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const directory = await (dependencies.directory ?? getMarketDirectory)();
  if (!directory.items.length) {
    return Response.json(
      { error: "市場目錄目前無法使用" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const known = new Set(directory.items.map((item) => item.symbol));
  const unknown = symbols.filter((symbol) => !known.has(symbol));
  if (unknown.length > 0) {
    return Response.json(
      { error: `市場目錄未確認商品：${unknown.join(", ")}` },
      {
        status: 404,
        headers: { "Cache-Control": "public, max-age=300" },
      },
    );
  }

  try {
    const payload = await loadShared(
      symbols,
      dependencies.load ?? loadMarketMetaCandidates,
    );
    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=3, stale-while-revalidate=2",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "行情取得失敗" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  return handleMarketMetaRequest(request);
}
