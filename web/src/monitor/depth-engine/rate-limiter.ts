export type RateLimitFailure = { status: number; retryAfterMs?: number };

function abortError() {
  const error = new Error("請求已取消");
  error.name = "AbortError";
  return error;
}

async function waitWithSignal(
  wait: Promise<void>,
  signal?: AbortSignal,
) {
  if (!signal) return wait;
  if (signal.aborted) throw abortError();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([wait, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

type LimiterState = {
  nextAllowedAt: number;
  blockedUntil: number;
  failures: number;
  lastFailureAt: number;
};

export function createRateLimiter({
  intervalFor,
  now = Date.now,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  intervalFor: (exchange: string, weight: number) => Promise<number> | number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const states = new Map<string, LimiterState>();
  const stateFor = (exchange: string) => {
    let state = states.get(exchange);
    if (!state) {
      state = { nextAllowedAt: 0, blockedUntil: 0, failures: 0, lastFailureAt: 0 };
      states.set(exchange, state);
    }
    return state;
  };

  return {
    async reserve(exchange: string, weight = 1, signal?: AbortSignal) {
      if (signal?.aborted) throw abortError();
      const interval = await intervalFor(exchange, weight);
      if (signal?.aborted) throw abortError();
      const state = stateFor(exchange);
      const measuredAt = now();
      const reservedAt = Math.max(measuredAt, state.nextAllowedAt, state.blockedUntil);
      state.nextAllowedAt = reservedAt + interval;
      if (reservedAt > measuredAt) {
        await waitWithSignal(sleep(reservedAt - measuredAt), signal);
      }
      return state;
    },
    recordFailure(exchange: string, error: RateLimitFailure) {
      if (error.status !== 418 && error.status !== 429 && error.status < 500) return;
      const state = stateFor(exchange);
      state.failures = Math.min(state.failures + 1, 5);
      state.lastFailureAt = now();
      const fallback = exchange === "Coinbase" && error.status === 429
        ? Math.min(300_000, 30_000 * 2 ** (state.failures - 1))
        : Math.min(60_000, 1000 * 2 ** (state.failures - 1));
      state.blockedUntil = Math.max(state.blockedUntil, now() + (error.retryAfterMs || fallback));
      state.nextAllowedAt = Math.max(state.nextAllowedAt, state.blockedUntil);
    },
    recordSuccess(exchange: string) {
      const state = stateFor(exchange);
      if (exchange !== "Coinbase" || now() - state.lastFailureAt >= 5 * 60 * 1000) {
        state.failures = 0;
        state.lastFailureAt = 0;
      }
    },
  };
}
