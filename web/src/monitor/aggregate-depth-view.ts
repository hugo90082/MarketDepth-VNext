import type { AggregateDepthSlot } from "./depth-settings.ts";
import { isDepthOption, responseAtDepth, type DepthOption } from "./depth-types.ts";
import type { CoinRow } from "./depth-view-model.ts";

export type AggregateMetric = "imbalance" | "bids" | "asks" | "total" | "complete";
export type AggregateSortKey = `aggregate:${number}:${AggregateMetric}`;

export function visibleAggregateDepths(
  slots: readonly AggregateDepthSlot[],
  primary: DepthOption,
  mobile: boolean,
): DepthOption[] {
  if (mobile) return [primary];
  const depths = slots
    .filter((slot) => slot.enabled)
    .map((slot) => slot.depth);
  if (!depths.includes(primary)) depths.push(primary);
  return [...new Set(depths)].sort((left, right) => left - right);
}

export function aggregateRowAtDepth(row: CoinRow, depth: DepthOption): CoinRow {
  if (!row.snapshot) return row;
  const selected = responseAtDepth(row.snapshot, depth);
  return {
    ...row,
    sources: selected.sources,
    bids: selected.bids,
    asks: selected.asks,
    imbalance: selected.imbalance,
  };
}

export function aggregateSortKey(
  depth: DepthOption,
  metric: AggregateMetric,
): AggregateSortKey {
  return `aggregate:${depth}:${metric}`;
}

export function parseAggregateSortKey(key: string) {
  const match = /^aggregate:([0-9.]+):(imbalance|bids|asks|total|complete)$/.exec(key);
  if (!match) return null;
  const depth = Number(match[1]);
  if (!isDepthOption(depth)) return null;
  return { depth, metric: match[2] as AggregateMetric };
}

export function aggregateSortValue(row: CoinRow, key: string): number | null {
  const parsed = parseAggregateSortKey(key);
  if (!parsed || !row.snapshot) return null;
  const selected = responseAtDepth(row.snapshot, parsed.depth);
  if (parsed.metric === "imbalance") return selected.imbalance;
  if (parsed.metric === "bids") return selected.bids;
  if (parsed.metric === "asks") return selected.asks;
  if (parsed.metric === "total") return selected.bids + selected.asks;
  return selected.complete;
}
