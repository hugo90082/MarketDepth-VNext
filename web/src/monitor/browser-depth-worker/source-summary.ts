import {
  aggregateRange,
  createRawBook,
  emptySource,
  summarizeBook,
  type RawBook,
  type Level,
} from "../depth-engine/order-book.ts";
import type {
  AcquisitionMode,
  AggregateRange,
  Quote,
  SourceResult,
  SourceStatus,
} from "../depth-types.ts";

export type BrowserBook = {
  bids: Level[];
  asks: Level[];
  tickSize?: number;
};

export function sourceFromBrowserBook(
  exchange: string,
  pair: string,
  quote: Quote,
  book: BrowserBook,
  startedAt: number,
  feed: string,
  metadata: {
    acquisitionMode?: AcquisitionMode;
    fallbackReason?: string;
    capturedAt?: number;
    lastMessageAt?: number;
    verifiedBounds?: RawBook['verifiedBounds'];
  } = {},
  now: () => number = Date.now,
): SourceResult {
  const capturedAt = metadata.capturedAt ?? now();
  return summarizeBook(
    exchange,
    createRawBook({
      bids: book.bids,
      asks: book.asks,
      pair,
      quote,
      feed,
      capturedAt,
      lastMessageAt: metadata.lastMessageAt,
      verifiedBounds: metadata.verifiedBounds,
      acquisitionMode: metadata.acquisitionMode ?? "official-api",
      tickSize: book.tickSize ?? 0,
      fallbackReason: metadata.fallbackReason,
    }),
    startedAt,
    () => capturedAt,
  );
}

export function emptyBrowserSource(
  exchange: string,
  quote: Quote,
  status: SourceStatus,
  error: string,
  acquisitionMode: AcquisitionMode = "official-api",
  now: () => number = Date.now,
): SourceResult {
  const capturedAt = now();
  return {
    ...emptySource(
      exchange,
      status,
      capturedAt,
      error,
      () => capturedAt,
      "—",
      quote,
    ),
    acquisitionMode,
    feed: "瀏覽器直連未取得",
  };
}

export function aggregateBrowserRange(
  sources: SourceResult[],
  depth: number,
): AggregateRange {
  return aggregateRange(sources, depth);
}
