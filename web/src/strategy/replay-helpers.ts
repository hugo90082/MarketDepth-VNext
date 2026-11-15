import {ASSETS, type Asset} from '../../shared/model';
import {HOUR, type PriceBar} from '../../shared/strategy-v37';
import type {Ledger} from '../../shared/strategy-v37-ledger';

export const TAIPEI_OFFSET = 8 * HOUR;

/** Align a timestamp down to an Asia/Taipei (UTC+8) fixed span so queries never cross day archives. */
export function taipeiSpanStart(t: number, spanMs: number): number {
 return Math.floor((t + TAIPEI_OFFSET) / spanMs) * spanMs - TAIPEI_OFFSET;
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
