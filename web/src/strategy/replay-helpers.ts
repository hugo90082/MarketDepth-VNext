import {ASSETS, type Asset} from '../../shared/model';
import {HOUR, type PriceBar} from '../../shared/strategy-v37';
import type {Ledger} from '../../shared/strategy-v37-ledger';

export const TAIPEI_OFFSET = 8 * HOUR;
export const TAIPEI_DAY_MS = 24 * HOUR;

/** Return the Asia/Taipei (UTC+8) calendar day index for a timestamp. */
export function taipeiDayIndex(t: number): number {
 return Math.floor((t + TAIPEI_OFFSET) / TAIPEI_DAY_MS);
}

/** Align a timestamp down to an Asia/Taipei (UTC+8) fixed span so queries never cross day archives. */
export function taipeiSpanStart(t: number, spanMs: number): number {
 return Math.floor((t + TAIPEI_OFFSET) / spanMs) * spanMs - TAIPEI_OFFSET;
}

/** Split [from, to) into spans of at most maxSpanMs that never cross 00:00 Asia/Taipei. */
export function splitTaipeiSpans(from: number, to: number, maxSpanMs: number): {from: number; to: number}[] {
 const spans: {from: number; to: number}[] = [];
 for (let cursor = from; cursor < to; ) {
  const nextMidnight = (taipeiDayIndex(cursor) + 1) * TAIPEI_DAY_MS - TAIPEI_OFFSET;
  const end = Math.min(to, cursor + maxSpanMs, nextMidnight);
  spans.push({from: cursor, to: end});
  cursor = end;
 }
 return spans;
}

/** Update unrealized-PnL mark prices capped at the current confirmed replay position. */
export function updateMarksFromPrices(
 ledger: Ledger,
 prices: Record<Asset, Map<number, PriceBar>>,
 markCeiling: number,
 target: number,
): void {
 for (const asset of ASSETS) {
  let latest: PriceBar | undefined;
  for (const bar of prices[asset].values()) {
   if (bar.t <= markCeiling && (!latest || bar.t > latest.t)) latest = bar;
  }
  const previous = ledger.marks[asset];
  if (latest && (!previous || latest.t >= previous.at)) {
   ledger.marks[asset] = {at: latest.t, price: latest.c, fresh: latest.t === target};
  } else if (previous) {
   ledger.marks[asset] = {...previous, fresh: false};
  }
 }
}
