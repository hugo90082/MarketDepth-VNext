const DEFAULT_READY_TIMEOUT_MS = 1_000;
const DEFAULT_READY_POLL_MS = 50;
const DEFAULT_MESSAGE_TIMEOUT_MS = 2_000;

/** @param {unknown} value @param {string} fallback */
function asError(value, fallback) {
  if (value instanceof Error) return value;
  const message = typeof value === "string"
    ? value
    : value && typeof value === "object" && "error" in value
      ? String(value.error ?? "")
      : "";
  return new Error(message || fallback);
}

/** @template T @param {Promise<T>} promise @param {number} timeoutMs @param {string} message @returns {Promise<T>} */
function withTimeout(promise, timeoutMs, message) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {{
 *   chromeApi: any;
 *   wait?: (ms: number) => Promise<void>;
 *   readyTimeoutMs?: number;
 *   readyPollMs?: number;
 *   messageTimeoutMs?: number;
 * }} options
 */
export function createAudioPlaybackController({
  chromeApi,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  readyPollMs = DEFAULT_READY_POLL_MS,
  messageTimeoutMs = DEFAULT_MESSAGE_TIMEOUT_MS,
}) {
  let queue = Promise.resolve();

  /** @param {Record<string, any>} message */
  async function send(message) {
    return withTimeout(
      chromeApi.runtime.sendMessage(message),
      messageTimeoutMs,
      "音訊頁回應逾時",
    );
  }

  async function waitUntilReady() {
    const attempts = Math.max(1, Math.ceil(readyTimeoutMs / readyPollMs) + 1);
    let lastError = new Error("音訊頁尚未就緒");
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await send({ type: "audio-ping" });
        if (response?.ok) return response;
        lastError = asError(response, "音訊頁尚未就緒");
      } catch (error) {
        lastError = asError(error, "音訊頁尚未就緒");
      }
      if (attempt < attempts - 1) await wait(readyPollMs);
    }
    throw lastError;
  }

  async function ensureReady() {
    const hasDocument = chromeApi.offscreen.hasDocument
      ? await chromeApi.offscreen.hasDocument()
      : (await chromeApi.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length > 0;
    if (!hasDocument) {
      await chromeApi.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "播放使用者設定的 CoinGlass 指標提醒聲音",
      });
    }
    await waitUntilReady();
  }

  async function resetDocument() {
    try {
      const hasDocument = chromeApi.offscreen.hasDocument
        ? await chromeApi.offscreen.hasDocument()
        : true;
      if (hasDocument) await chromeApi.offscreen.closeDocument();
    } catch {
      // 文件可能已被 Chrome 回收；下一步仍直接重建。
    }
  }

  /** @param {Array<string>} events */
  async function attempt(events) {
    await ensureReady();
    const response = await send({ type: "play-sound", events });
    if (!response?.ok) throw asError(response, "聲音播放失敗");
    if (response.contextState !== "running") {
      throw new Error(`音訊無法啟動（${response.contextState || "unknown"}）`);
    }
    return response;
  }

  /** @param {Array<string>} events */
  async function playWithRecovery(events) {
    try {
      return await attempt(events);
    } catch {
      await resetDocument();
      return attempt(events);
    }
  }

  /** @param {Array<string>} events */
  function play(events) {
    const work = queue.catch(() => undefined).then(() => playWithRecovery(events));
    queue = work.catch(() => undefined);
    return work;
  }

  return { play };
}
