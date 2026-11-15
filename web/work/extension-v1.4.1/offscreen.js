import { buildSoundCue } from "./lib/sound-cue.js";

let context;
let compressor;

async function ensureAudioGraph() {
  if (context?.state === "closed") {
    context = undefined;
    compressor = undefined;
  }
  context ??= new AudioContext();
  if (context.state === "suspended") await context.resume();
  if (context.state !== "running") throw new Error(`AudioContext 無法啟動（${context.state}）`);
  if (!compressor) {
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 6;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    compressor.connect(context.destination);
  }
  return { context, compressor };
}

async function playEvents(events) {
  const notes = buildSoundCue(events);
  if (!notes.length) throw new Error("沒有可播放的提醒聲音");
  const graph = await ensureAudioGraph();
  let at = context.currentTime + 0.02;
  notes.forEach((note, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const duration = note.durationMs / 1_000;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(note.start, at);
    if (note.end) oscillator.frequency.exponentialRampToValueAtTime(note.end, at + duration);
    gain.gain.setValueAtTime(0.001, at);
    gain.gain.exponentialRampToValueAtTime(0.24, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    oscillator.connect(gain).connect(graph.compressor);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
    at += duration + (index === 0 && note.durationMs === 700 ? 0.16 : 0.06);
  });
  return { ok: true, contextState: context.state, scheduledAt: Date.now() };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "audio-ping") {
    sendResponse({ ok: true, contextState: context?.state ?? "none" });
    return false;
  }
  if (message?.type !== "play-sound") return false;
  playEvents(message.events).then(sendResponse).catch((error) => sendResponse({
    ok: false,
    contextState: context?.state ?? "none",
    error: error instanceof Error ? error.message : "聲音播放失敗",
  }));
  return true;
});
