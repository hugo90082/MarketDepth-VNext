import { DEPTH_OPTIONS, depthKey, type DepthResponse, type Quote, type SourceResult } from "../depth-types.ts";
import { aggregateRange, emptySource, summarizeBook, type RawBook } from "./order-book.ts";

export type DepthSourceAdapter = {
  exchange: string;
  load(symbol: string, signal: AbortSignal): Promise<RawBook>;
  delayedMarket?: (symbol: string) => { pair: string; quote: Quote };
};

export type DepthEngineOptions = {
  adapters: readonly DepthSourceAdapter[];
  now?: () => number;
  softDeadlineMs?: number;
  isUnsupported?: (error: unknown) => boolean;
  onSourceSummarized?: (symbol: string, source: SourceResult, book: RawBook) => void;
};

export function createDepthEngine({
  adapters,
  now = Date.now,
  softDeadlineMs = 30_000,
  isUnsupported = () => false,
  onSourceSummarized,
}: DepthEngineOptions) {
  const sourceResult = async (adapter: DepthSourceAdapter, symbol: string) => {
    const startedAt = now();
    const controller = new AbortController();
    let timedOut = false;
    const delayedSource = () => {
      const market = adapter.delayedMarket?.(symbol);
      return emptySource(
        adapter.exchange,
        "delayed",
        startedAt,
        `等待超過 ${softDeadlineMs / 1000} 秒，本輪未納入`,
        now,
        market?.pair,
        market?.quote,
      );
    };
    const task = adapter.load(symbol, controller.signal)
      .then((book) => {
        const source = summarizeBook(adapter.exchange, book, startedAt, now);
        onSourceSummarized?.(symbol, source, book);
        return source;
      })
      .catch((error) => timedOut
        ? delayedSource()
        : emptySource(
            adapter.exchange,
            isUnsupported(error) ? "unsupported" : "error",
            startedAt,
            error instanceof Error ? error.message : "未知錯誤",
            now,
          ));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delayed = new Promise<SourceResult>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve(delayedSource());
        controller.abort();
      }, softDeadlineMs);
    });
    try {
      return await Promise.race([task, delayed]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return {
    async aggregate(symbol: string, selectedExchanges?: readonly string[]): Promise<DepthResponse> {
      const selected = selectedExchanges
        ? adapters.filter((adapter) => selectedExchanges.includes(adapter.exchange))
        : [...adapters];
      const sources = await Promise.all(selected.map((adapter) => sourceResult(adapter, symbol)));
      const ranges = Object.fromEntries(DEPTH_OPTIONS.map((depth) => [depthKey(depth), aggregateRange(sources, depth)]));
      return {
        symbol,
        depth: 10,
        sources,
        ranges,
        ...ranges[depthKey(10)],
        binancePerp: false,
        generatedAt: now(),
      };
    },
  };
}

export type DepthEngine = ReturnType<typeof createDepthEngine>;
