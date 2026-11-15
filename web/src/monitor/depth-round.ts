import {
  DeadlineExceededError,
  withAbortDeadline,
} from "./request-deadline.ts";

export const SOURCE_REQUEST_DEADLINE_MS = 30_000;
export const SYMBOL_ROUND_DEADLINE_MS = 45_000;

type LayeredDepthRoundOptions<T, K> = {
  loadPrimary: (signal: AbortSignal) => Promise<T>;
  fallbackKeys: (primary: T) => K[];
  loadFallback: (keys: K[], signal: AbortSignal) => Promise<T>;
  merge: (primary: T, fallback: T) => T;
  primaryDeadlineMs?: number;
  roundDeadlineMs?: number;
  now?: () => number;
};

export async function runLayeredDepthRound<T, K = string>({
  loadPrimary,
  fallbackKeys,
  loadFallback,
  merge,
  primaryDeadlineMs = SOURCE_REQUEST_DEADLINE_MS,
  roundDeadlineMs = SYMBOL_ROUND_DEADLINE_MS,
  now = Date.now,
}: LayeredDepthRoundOptions<T, K>) {
  const startedAt = now();
  let primary: T | undefined;

  try {
    primary = await withAbortDeadline(
      loadPrimary,
      Math.min(primaryDeadlineMs, roundDeadlineMs),
      `瀏覽器資料等待超過 ${Math.min(primaryDeadlineMs, roundDeadlineMs) / 1000} 秒`,
    );
  } catch {
    // The cloud request below is the only fallback and shares this round's budget.
  }

  const keys = primary === undefined ? [] : fallbackKeys(primary);
  if (primary !== undefined && keys.length === 0) return primary;

  const elapsed = Math.max(0, now() - startedAt);
  const remainingMs = Math.max(0, roundDeadlineMs - elapsed);
  if (remainingMs === 0) {
    if (primary !== undefined) return primary;
    throw new DeadlineExceededError(`商品整輪等待超過 ${roundDeadlineMs / 1000} 秒`);
  }

  try {
    const fallback = await withAbortDeadline(
      (signal) => loadFallback(keys, signal),
      remainingMs,
      `商品整輪等待超過 ${roundDeadlineMs / 1000} 秒`,
    );
    return primary === undefined ? fallback : merge(primary, fallback);
  } catch (error) {
    if (primary !== undefined) return primary;
    if (error instanceof DeadlineExceededError) throw error;
    throw error;
  }
}
