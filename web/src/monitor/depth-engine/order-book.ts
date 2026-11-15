import {
  DEPTH_OPTIONS,
  countPriceBuckets,
  depthKey,
  dynamicBucketSize,
  type AcquisitionMode,
  type AggregateRange,
  type Completeness,
  type Quote,
  type SourceRange,
  type SourceResult,
  type SourceStatus,
} from "../depth-types.ts";

export type Level = [number, number];

export type RawBook = {
  bids: Level[];
  asks: Level[];
  pair: string;
  quote: Quote;
  feed: string;
  capturedAt: number;
  lastMessageAt?: number;
  verifiedBounds?: {bid: number; ask: number};
  snapshotAt?: number;
  coverageMode?: 'sequenced-diff';
  snapshotCount: number;
  mergeWindowMs: number;
  temporalMerged: boolean;
  acquisitionMode: AcquisitionMode;
  tickSize: number;
  fallbackReason?: string;
};

export type RawBookInput = Pick<RawBook, "bids" | "asks" | "pair" | "quote" | "feed">
  & Partial<Omit<RawBook, "bids" | "asks" | "pair" | "quote" | "feed">>;

export function normalizeLevels(raw: unknown): Level[] {
  return Array.isArray(raw)
    ? raw
      .map((item): Level => Array.isArray(item) ? [Number(item[0]), Number(item[1])] : [0, 0])
      .filter(([price, quantity]) => Number.isFinite(price) && Number.isFinite(quantity) && price > 0 && quantity >= 0)
    : [];
}

export function createRawBook(input: RawBookInput): RawBook {
  return {
    bids: input.bids.filter(([, quantity]) => quantity > 0).sort((a, b) => b[0] - a[0]),
    asks: input.asks.filter(([, quantity]) => quantity > 0).sort((a, b) => a[0] - b[0]),
    pair: input.pair,
    quote: input.quote,
    feed: input.feed,
    capturedAt: input.capturedAt ?? Date.now(),
    lastMessageAt: input.lastMessageAt,
    verifiedBounds: input.verifiedBounds,
    snapshotAt: input.snapshotAt,
    coverageMode: input.coverageMode,
    snapshotCount: input.snapshotCount ?? 1,
    mergeWindowMs: input.mergeWindowMs ?? 0,
    temporalMerged: input.temporalMerged ?? false,
    acquisitionMode: input.acquisitionMode ?? "cloud-fallback",
    tickSize: input.tickSize ?? 0,
    fallbackReason: input.fallbackReason,
  };
}

export function summarizeRange(depth: number, book: RawBook): SourceRange {
  const bestBid = book.bids[0]?.[0] ?? 0;
  const bestAsk = book.asks[0]?.[0] ?? 0;
  if (!bestBid || !bestAsk) throw new Error("訂單簿為空");
  const mid = (bestBid + bestAsk) / 2;
  const floor = mid * (1 - depth / 100);
  const ceiling = mid * (1 + depth / 100);
  const bidRows = book.bids.filter(([price]) => price >= floor);
  const askRows = book.asks.filter(([price]) => price <= ceiling);
  const bids = bidRows.reduce((sum, [price, quantity]) => sum + price * quantity, 0);
  const asks = askRows.reduce((sum, [price, quantity]) => sum + price * quantity, 0);
  const lastBid = book.verifiedBounds?.bid ?? book.bids.at(-1)?.[0] ?? bestBid;
  const lastAsk = book.verifiedBounds?.ask ?? book.asks.at(-1)?.[0] ?? bestAsk;
  const bidCoverage = Math.min(100, Math.max(0, (mid - lastBid) / mid * 100));
  const askCoverage = Math.min(100, Math.max(0, (lastAsk - mid) / mid * 100));
  const complete = bidRows.length > 0 && askRows.length > 0
    && bidCoverage >= depth && askCoverage >= depth;
  const completeness: Completeness = complete ? (book.temporalMerged ? "merged" : "instant") : "partial";
  return {
    status: complete ? "ok" : "partial",
    bids,
    asks,
    imbalance: bids + asks ? (bids - asks) / (bids + asks) : null,
    levels: bidRows.length + askRows.length,
    bidCoverage,
    askCoverage,
    coverageVerified: complete,
    completeness,
  };
}

export function summarizeBook(
  exchange: string,
  book: RawBook,
  startedAt: number,
  now: () => number = Date.now,
): SourceResult {
  const ranges = Object.fromEntries(DEPTH_OPTIONS.map((depth) => [depthKey(depth), summarizeRange(depth, book)]));
  const selected = ranges[depthKey(10)];
  const bestBid = book.bids[0]?.[0] ?? 0;
  const bestAsk = book.asks[0]?.[0] ?? 0;
  const bucketSize = dynamicBucketSize((bestBid + bestAsk) / 2, book.tickSize);
  const rawLevelCount = book.bids.length + book.asks.length;
  const measuredAt = now();
  return {
    exchange,
    pair: book.pair,
    quote: book.quote,
    ...selected,
    latency: measuredAt - startedAt,
    time: measuredAt,
    lastMessageAt: book.lastMessageAt,
    snapshotCount: book.snapshotCount,
    mergeWindowMs: book.mergeWindowMs,
    temporalMerged: book.temporalMerged,
    rawBidLevels: book.bids.length,
    rawAskLevels: book.asks.length,
    rawLevelCount,
    bucketSize,
    bucketCount: countPriceBuckets(book.bids, book.asks, bucketSize),
    bidCoveragePct: selected.bidCoverage,
    askCoveragePct: selected.askCoverage,
    acquisitionMode: book.acquisitionMode,
    ageMs: Math.max(0, measuredAt - (book.lastMessageAt ?? book.capturedAt)),
    feed: book.feed,
    ranges,
    fallbackReason: book.fallbackReason,
  };
}

export function emptySource(
  exchange: string,
  status: SourceStatus,
  startedAt: number,
  error: string,
  now: () => number = Date.now,
  pair = "—",
  quote: Quote = exchange === "Coinbase" ? "USD" : "USDT",
): SourceResult {
  const emptyRange: SourceRange = {
    status,
    bids: 0,
    asks: 0,
    imbalance: null,
    levels: 0,
    bidCoverage: 0,
    askCoverage: 0,
    coverageVerified: false,
    completeness: "partial",
  };
  const measuredAt = now();
  return {
    exchange,
    pair,
    quote,
    ...emptyRange,
    latency: measuredAt - startedAt,
    time: measuredAt,
    snapshotCount: 0,
    mergeWindowMs: 0,
    temporalMerged: false,
    rawBidLevels: 0,
    rawAskLevels: 0,
    rawLevelCount: 0,
    bucketSize: 0,
    bucketCount: 0,
    bidCoveragePct: 0,
    askCoveragePct: 0,
    acquisitionMode: "cloud-fallback",
    ageMs: 0,
    feed: "未取得",
    error,
    ranges: Object.fromEntries(DEPTH_OPTIONS.map((depth) => [depthKey(depth), { ...emptyRange }])),
  };
}

export function aggregateRange(sources: SourceResult[], depth: number): AggregateRange {
  const ranges = sources.map((source) => source.ranges[depthKey(depth)]).filter(Boolean);
  const usable = ranges.filter((range) => (range.status === "ok" || range.status === "partial") && range.bids + range.asks > 0);
  const bids = usable.reduce((sum, range) => sum + range.bids, 0);
  const asks = usable.reduce((sum, range) => sum + range.asks, 0);
  const success = usable.length;
  const instantComplete = usable.filter((range) => range.completeness === "instant").length;
  const mergedComplete = usable.filter((range) => range.completeness === "merged").length;
  return {
    bids,
    asks,
    imbalance: success >= 1 && bids + asks > 0 ? (bids - asks) / (bids + asks) : null,
    success,
    complete: instantComplete + mergedComplete,
    instantComplete,
    mergedComplete,
  };
}
