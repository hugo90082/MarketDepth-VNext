const BUY_SCALE = [740, 988, 1319];
const SELL_SCALE = [440, 330, 247];

/** @param {string} event */
function tierOf(event) {
  if (!/^(buy|sell)[123]$/.test(event)) return 0;
  return Number(event.at(-1));
}

/** @param {string[]} events */
export function buildSoundCue(events) {
  const values = Array.isArray(events) ? events : [];
  const direction = values.find((event) => event === "direction-buy" || event === "direction-sell");
  const threshold = values
    .filter((event) => tierOf(event) > 0)
    .sort((left, right) => tierOf(right) - tierOf(left))[0];
  const notes = [];
  if (direction === "direction-buy") notes.push({ start: 330, end: 988, durationMs: 700 });
  if (direction === "direction-sell") notes.push({ start: 988, end: 330, durationMs: 700 });
  if (threshold) {
    const scale = threshold.startsWith("buy") ? BUY_SCALE : SELL_SCALE;
    notes.push(...scale.slice(0, tierOf(threshold)).map((start) => ({ start, durationMs: 160 })));
  }
  if (notes.length) return notes;
  const upward = values.some((event) => event === "above" || event === "cross-up");
  const downward = values.some((event) => event === "below" || event === "cross-down");
  if (upward && !downward) return [660, 880].map((start) => ({ start, durationMs: 160 }));
  if (downward && !upward) return [550, 330].map((start) => ({ start, durationMs: 160 }));
  return [440, 660, 880].map((start) => ({ start, durationMs: 160 }));
}
