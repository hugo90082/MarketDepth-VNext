export const DEPTH_MIN = 0.25;
export const DEPTH_MAX = 10;
export const DEPTH_STEP = 0.25;
export const DEPTH_OPTIONS = Array.from(
  { length: Math.round((DEPTH_MAX - DEPTH_MIN) / DEPTH_STEP) + 1 },
  (_, index) => Number((DEPTH_MIN + index * DEPTH_STEP).toFixed(2)),
);
export const DEPTH_SHORTCUTS = [0.5, 1, 2, 3, 5, 10] as const;
export type DepthOption = number;

export function isDepthOption(value: number): value is DepthOption {
  if (!Number.isFinite(value) || value < DEPTH_MIN || value > DEPTH_MAX) return false;
  const steps = (value - DEPTH_MIN) / DEPTH_STEP;
  return Math.abs(steps - Math.round(steps)) < Number.EPSILON * 16;
}
export type Quote = import("./market-ranking").MarketQuote;
export type SourceStatus = "ok" | "partial" | "error" | "unsupported" | "delayed";
export type Completeness = "instant" | "merged" | "partial";
export type AcquisitionMode = "web-feed" | "official-api" | "cloud-fallback";

export type SourceRange = {
  status: SourceStatus;
  bids: number;
  asks: number;
  imbalance: number | null;
  levels: number;
  bidCoverage: number;
  askCoverage: number;
  coverageVerified: boolean;
  completeness: Completeness;
};

export type SourceResult = SourceRange & {
  exchange: string;
  pair: string;
  quote: Quote;
  latency: number;
  time: number;
  lastMessageAt?: number;
  snapshotCount: number;
  mergeWindowMs: number;
  temporalMerged: boolean;
  rawBidLevels: number;
  rawAskLevels: number;
  rawLevelCount: number;
  bucketSize: number;
  bucketCount: number;
  bidCoveragePct: number;
  askCoveragePct: number;
  acquisitionMode: AcquisitionMode;
  ageMs: number;
  feed: string;
  ranges: Record<string, SourceRange>;
  error?: string;
  fallbackReason?: string;
};

export type AggregateRange = {
  bids: number;
  asks: number;
  imbalance: number | null;
  success: number;
  complete: number;
  instantComplete: number;
  mergedComplete: number;
};

export type DepthResponse = AggregateRange & {
  symbol: string;
  depth: DepthOption;
  sources: SourceResult[];
  ranges: Record<string, AggregateRange>;
  binancePerp: boolean;
  generatedAt: number;
  cached?: boolean;
};

export function depthKey(depth: number) {
  return String(Number(depth.toFixed(2)));
}

const NICE_BUCKET_FACTORS = [1, 2, 5, 10] as const;

export function dynamicBucketSize(mid: number, tickSize = 0, targetDepth = 10, targetBucketsPerSide = 64) {
  if (!Number.isFinite(mid) || mid <= 0) return 0;
  const raw = mid * (targetDepth / 100) / targetBucketsPerSide;
  const power = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / power;
  const factor = NICE_BUCKET_FACTORS.reduce((nearest, candidate) => (
    Math.abs(candidate - scaled) < Math.abs(nearest - scaled) ? candidate : nearest
  ), NICE_BUCKET_FACTORS[0]);
  const nice = factor * power;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return nice;
  const ticks = Math.max(1, Math.round(nice / tickSize));
  return Number((ticks * tickSize).toPrecision(12));
}

export function countPriceBuckets(
  bids: ReadonlyArray<readonly [number, number]>,
  asks: ReadonlyArray<readonly [number, number]>,
  bucketSize: number,
) {
  if (!Number.isFinite(bucketSize) || bucketSize <= 0) return 0;
  const buckets = new Set<string>();
  bids.forEach(([price]) => buckets.add(`b:${Math.floor(price / bucketSize)}`));
  asks.forEach(([price]) => buckets.add(`a:${Math.ceil(price / bucketSize)}`));
  return buckets.size;
}

export function sourceAtDepth(source: SourceResult, depth: number): SourceResult {
  const range = source.ranges?.[depthKey(depth)];
  return range ? {
    ...source,
    ...range,
    bidCoveragePct: range.bidCoverage,
    askCoveragePct: range.askCoverage,
  } : source;
}

export function responseAtDepth(payload: DepthResponse, depth: DepthOption): DepthResponse {
  const range = payload.ranges?.[depthKey(depth)];
  if (!range) return payload;
  return {
    ...payload,
    ...range,
    depth,
    sources: payload.sources.map((source) => sourceAtDepth(source, depth)),
  };
}
