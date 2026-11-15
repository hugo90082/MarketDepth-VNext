export const DEFAULT_COLUMN_ORDER = [
  "strength",
  "aggregate",
  "exchanges",
  "update",
] as const;

export type ColumnBlock = typeof DEFAULT_COLUMN_ORDER[number];

const SYMBOL_PRIORITY: Record<string, number> = {
  BTC: 0,
  ETH: 1,
  SOL: 2,
};

export function symbolCompare(left: string, right: string) {
  const rankA = SYMBOL_PRIORITY[left] ?? 999;
  const rankB = SYMBOL_PRIORITY[right] ?? 999;
  return rankA !== rankB ? rankA - rankB : left.localeCompare(right);
}

export function normalizeRowOrder(
  symbols: readonly string[],
  candidate?: readonly string[],
) {
  const available = [...new Set(symbols)];
  if (!candidate) return available.sort(symbolCompare);
  const availableSet = new Set(available);
  const result = [...new Set(candidate)].filter((symbol) => availableSet.has(symbol));
  const included = new Set(result);
  available.forEach((symbol) => {
    if (!included.has(symbol)) result.push(symbol);
  });
  return result;
}

export function normalizeColumnOrder(candidate?: readonly string[]) {
  const allowed = new Set<string>(DEFAULT_COLUMN_ORDER);
  const result = [...new Set(candidate ?? [])]
    .filter((item): item is ColumnBlock => allowed.has(item));
  DEFAULT_COLUMN_ORDER.forEach((item) => {
    if (!result.includes(item)) result.push(item);
  });
  return result;
}

export function moveOrderItem<T extends string>(
  order: readonly T[],
  item: T,
  before: T,
) {
  if (item === before || !order.includes(item) || !order.includes(before)) {
    return [...order];
  }
  const next = order.filter((entry) => entry !== item);
  next.splice(next.indexOf(before), 0, item);
  return next;
}
