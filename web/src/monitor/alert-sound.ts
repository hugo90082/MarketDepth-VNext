import type { AlertEvent } from "./alert-policy.ts";

export const BUY_SCALE_HZ = [740, 988, 1319] as const;
export const SELL_SCALE_HZ = [440, 330, 247] as const;
export const DIRECTION_LOW_HZ = 330;
export const DIRECTION_HIGH_HZ = 988;
const NOTE_MS = 160;
const GLIDE_MS = 700;
const NOTE_GAP_MS = 60;
const GROUP_GAP_MS = 160;

export type AlertNote = {
  startFrequency: number;
  endFrequency?: number;
  durationMs: number;
  gapAfterMs: number;
};

export type AlertCue = {
  notes: AlertNote[];
  priority: number;
  signature: string;
};

export type AlertSoundRequest = {
  symbol: string;
  events: AlertEvent[];
  cue: AlertCue;
  createdAt: number;
};

function tierOf(event: AlertEvent) {
  if (event === "direction-buy" || event === "direction-sell") return 0;
  return event.endsWith("3") ? 3 : event.endsWith("2") ? 2 : 1;
}

function note(startFrequency: number, gapAfterMs = NOTE_GAP_MS): AlertNote {
  return { startFrequency, durationMs: NOTE_MS, gapAfterMs };
}

function glide(startFrequency: number, endFrequency: number, gapAfterMs: number): AlertNote {
  return { startFrequency, endFrequency, durationMs: GLIDE_MS, gapAfterMs };
}

export function buildAlertCue(events: readonly AlertEvent[]): AlertCue {
  const direction = events.find((event) => event === "direction-buy" || event === "direction-sell");
  const threshold = events
    .filter((event) => event !== "direction-buy" && event !== "direction-sell")
    .sort((left, right) => tierOf(right) - tierOf(left))[0];
  const notes: AlertNote[] = [];

  if (direction === "direction-buy") {
    notes.push(glide(DIRECTION_LOW_HZ, DIRECTION_HIGH_HZ, threshold ? GROUP_GAP_MS : 0));
  } else if (direction === "direction-sell") {
    notes.push(glide(DIRECTION_HIGH_HZ, DIRECTION_LOW_HZ, threshold ? GROUP_GAP_MS : 0));
  }

  if (threshold) {
    const tier = tierOf(threshold);
    const scale = threshold.startsWith("buy") ? BUY_SCALE_HZ : SELL_SCALE_HZ;
    notes.push(...scale.slice(0, tier).map((frequency, index) => (
      note(frequency, index === tier - 1 ? 0 : NOTE_GAP_MS)
    )));
  }

  return {
    notes,
    priority: direction ? 4 : threshold ? tierOf(threshold) : 0,
    signature: `${direction ?? ""}|${threshold ?? ""}`,
  };
}

export function createAlertSoundQueue({
  playCue,
  stopActive,
  maxSize = 5,
  now = Date.now,
}: {
  playCue: (cue: AlertCue) => Promise<void>;
  stopActive: () => void;
  maxSize?: number;
  now?: () => number;
}) {
  let active: AlertSoundRequest | null = null;
  let pending: AlertSoundRequest[] = [];
  let generation = 0;

  const snapshot = () => active ? [active, ...pending] : [...pending];

  const pump = () => {
    if (active || pending.length === 0) return;
    active = pending.shift() ?? null;
    if (!active) return;
    const currentGeneration = generation;
    void playCue(active.cue).catch(() => undefined).finally(() => {
      if (currentGeneration !== generation) return;
      active = null;
      pump();
    });
  };

  const trim = () => {
    while (snapshot().length > maxSize && pending.length) {
      let removeIndex = 0;
      for (let index = 1; index < pending.length; index += 1) {
        const candidate = pending[index];
        const selected = pending[removeIndex];
        if (
          candidate.cue.priority < selected.cue.priority
          || (candidate.cue.priority === selected.cue.priority && candidate.createdAt < selected.createdAt)
        ) removeIndex = index;
      }
      pending.splice(removeIndex, 1);
    }
  };

  return {
    enqueue(symbol: string, events: readonly AlertEvent[]) {
      const cue = buildAlertCue(events);
      if (!cue.notes.length) return;
      const request: AlertSoundRequest = { symbol, events: [...events], cue, createdAt: now() };
      const duplicate = pending.findIndex((item) => item.symbol === symbol && item.cue.signature === cue.signature);
      if (duplicate >= 0) pending[duplicate] = request;
      else pending.push(request);
      trim();
      pump();
    },
    clearSymbol(symbol: string) {
      pending = pending.filter((item) => item.symbol !== symbol);
      if (active?.symbol !== symbol) return;
      generation += 1;
      stopActive();
      active = null;
      pump();
    },
    stopAll() {
      generation += 1;
      if (active) stopActive();
      active = null;
      pending = [];
    },
    snapshot,
  };
}

export type AlertSoundPlayer = ReturnType<typeof createBrowserAlertSoundPlayer>;

export function createBrowserAlertSoundPlayer() {
  let context: AudioContext | null = null;
  let output: DynamicsCompressorNode | null = null;
  let activeMaster: GainNode | null = null;
  let activeTimer: number | null = null;
  let finishActive: (() => void) | null = null;

  const ensureContext = async () => {
    if (!context) {
      context = new AudioContext();
      output = context.createDynamicsCompressor();
      output.threshold.value = -12;
      output.knee.value = 6;
      output.ratio.value = 8;
      output.attack.value = 0.003;
      output.release.value = 0.12;
      output.connect(context.destination);
    }
    if (context.state === "suspended") await context.resume();
    return context;
  };

  const stopActive = () => {
    if (activeTimer !== null) window.clearTimeout(activeTimer);
    activeTimer = null;
    if (activeMaster && context) {
      const time = context.currentTime;
      activeMaster.gain.cancelScheduledValues(time);
      activeMaster.gain.setValueAtTime(Math.max(activeMaster.gain.value, 0.0001), time);
      activeMaster.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    }
    activeMaster = null;
    finishActive?.();
    finishActive = null;
  };

  const playCue = async (cue: AlertCue) => {
    const audio = await ensureContext();
    const master = audio.createGain();
    master.gain.value = 1;
    master.connect(output ?? audio.destination);
    activeMaster = master;
    let offsetMs = 0;
    for (const item of cue.notes) {
      const start = audio.currentTime + offsetMs / 1000;
      const end = start + item.durationMs / 1000;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(item.startFrequency, start);
      if (item.endFrequency !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(item.endFrequency, end);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.24, start + 0.012);
      gain.gain.setValueAtTime(0.24, Math.max(start + 0.012, end - 0.045));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
      offsetMs += item.durationMs + item.gapAfterMs;
    }
    await new Promise<void>((resolve) => {
      finishActive = resolve;
      activeTimer = window.setTimeout(() => {
        activeTimer = null;
        activeMaster = null;
        finishActive = null;
        resolve();
      }, Math.max(1, offsetMs));
    });
  };

  const queue = createAlertSoundQueue({ playCue, stopActive });
  let previewSequence = 0;
  return {
    prime: ensureContext,
    enqueue: (symbol: string, events: readonly AlertEvent[]) => queue.enqueue(symbol, events),
    preview: (event: AlertEvent) => queue.enqueue(`__preview-${++previewSequence}`, [event]),
    clearSymbol: queue.clearSymbol,
    stopAll: queue.stopAll,
    destroy: () => {
      queue.stopAll();
      const closing = context?.close();
      context = null;
      output = null;
      return closing;
    },
  };
}
