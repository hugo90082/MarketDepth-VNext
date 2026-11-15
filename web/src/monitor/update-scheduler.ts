export type QueueStatus = Record<
  string,
  { position: number; total: number }
>;

export type SchedulerDecision = {
  symbol: string | null;
  waitMs: number;
};

export type UpdateSchedulerOptions = {
  symbols: () => string[];
  paused: () => Set<string>;
  isRunning: (symbol: string) => boolean;
  startedAt: (symbol: string) => number;
  resumed?: Set<string>;
  refreshSeconds: number;
  gapSeconds: number;
  pageVisible: boolean;
  refresh: (symbol: string) => Promise<unknown> | unknown;
  onQueue: (queue: QueueStatus) => void;
  compare?: (left: string, right: string) => number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function effectiveRefreshMs(
  refreshSeconds: number,
  pageVisible: boolean,
) {
  return refreshSeconds * 1000 * (pageVisible ? 1 : 5);
}

export function createUpdateScheduler(options: UpdateSchedulerOptions) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep
    ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const compare = options.compare ?? ((left, right) => left.localeCompare(right));
  const effectiveInterval = effectiveRefreshMs(
    options.refreshSeconds,
    options.pageVisible,
  );
  const nextEligibleAt = new Map<string, number>();
  let stopped = false;

  for (const symbol of options.symbols()) {
    const startedAt = options.startedAt(symbol);
    nextEligibleAt.set(
      symbol,
      options.resumed?.has(symbol)
        ? 0
        : startedAt
          ? startedAt + effectiveInterval
          : 0,
    );
  }

  const step = async (): Promise<SchedulerDecision> => {
    const active = options.symbols()
      .filter((symbol) => !options.paused().has(symbol))
      .sort(
        (left, right) => (nextEligibleAt.get(left) ?? 0)
          - (nextEligibleAt.get(right) ?? 0)
          || compare(left, right),
      );
    const waiting = active.filter((symbol) => !options.isRunning(symbol));
    options.onQueue(Object.fromEntries(
      waiting.map((symbol, index) => [
        symbol,
        { position: index + 1, total: waiting.length },
      ]),
    ));

    const currentTime = now();
    const symbol = waiting.find(
      (item) => (nextEligibleAt.get(item) ?? 0) <= currentTime,
    );
    if (!symbol) {
      const nextAt = waiting.length
        ? Math.min(
          ...waiting.map(
            (item) => nextEligibleAt.get(item) ?? currentTime + 250,
          ),
        )
        : currentTime + 250;
      return {
        symbol: null,
        waitMs: Math.max(50, Math.min(250, nextAt - currentTime)),
      };
    }

    nextEligibleAt.set(symbol, currentTime + effectiveInterval);
    void options.refresh(symbol);
    return {
      symbol,
      waitMs: options.gapSeconds * 1000,
    };
  };

  const run = async () => {
    while (!stopped) {
      const decision = await step();
      await sleep(decision.waitMs);
    }
  };

  return {
    step,
    run,
    stop: () => {
      stopped = true;
    },
  };
}
