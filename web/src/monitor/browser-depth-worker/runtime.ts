import {
  DeadlineExceededError,
  withAbortDeadline,
} from "../request-deadline.ts";

export type BrowserSourceTask<T> = {
  exchange: string;
  load: (signal: AbortSignal) => Promise<T>;
  delayed: () => T;
  failed: (error: unknown) => T;
};

export async function settleBrowserSourceTasks<T>(
  tasks: readonly BrowserSourceTask<T>[],
  deadlineMs: number,
) {
  return Promise.all(tasks.map(async (task) => {
    try {
      return await withAbortDeadline(
        task.load,
        deadlineMs,
        `${task.exchange} 等待超過 ${deadlineMs / 1000} 秒`,
      );
    } catch (error) {
      return error instanceof DeadlineExceededError
        ? task.delayed()
        : task.failed(error);
    }
  }));
}
