export class DeadlineExceededError extends Error {
  readonly code = "DEADLINE_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "DeadlineExceededError";
  }
}

type DeadlineTimers = {
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};

export async function withAbortDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
  timers: DeadlineTimers = {},
): Promise<T> {
  const controller = new AbortController();
  const setTimer = timers.setTimer ?? setTimeout;
  const clearTimer = timers.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimer(() => {
      reject(new DeadlineExceededError(message));
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimer(timer);
  }
}
