/** @param {string} interval */
export function intervalToMs(interval) {
  const value = String(interval ?? "").trim().toUpperCase();
  if (/^\d+$/.test(value)) return Number(value) * 60_000;
  const match = /^(\d+)([SMHDW])$/.exec(value);
  if (!match) return null;
  const factor = { S: 1_000, M: 60_000, H: 3_600_000, D: 86_400_000, W: 604_800_000 }[match[2]];
  if (!factor) return null;
  return Number(match[1]) * factor;
}

/**
 * @typedef {{ buckets: Array<{bucket:number, valid:boolean}>, gapDetected: boolean }} GapState
 */

/**
 * @param {GapState | undefined} previous
 * @param {{now:number, valid:boolean, intervalMs:number|null, heartbeatGapMs:number}} input
 * @returns {GapState}
 */
export function advanceGapState(previous, input) {
  if (!input.intervalMs || input.intervalMs <= 0) return { buckets: [], gapDetected: false };
  const state = { buckets: [...(previous?.buckets ?? [])], gapDetected: false };
  const bucket = Math.floor(input.now / input.intervalMs);
  const current = state.buckets.find((item) => item.bucket === bucket);
  if (current) current.valid = current.valid || input.valid;
  else state.buckets.push({ bucket, valid: input.valid });
  state.buckets.sort((a, b) => a.bucket - b.bucket);
  state.buckets = state.buckets.slice(-20);

  const heartbeatHealthy = input.heartbeatGapMs <= Math.max(35_000, input.intervalMs);
  if (input.valid && heartbeatHealthy) {
    const currentIndex = state.buckets.findIndex((item) => item.bucket === bucket);
    const previousValidIndex = state.buckets
      .slice(0, currentIndex)
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.valid)
      .at(-1)?.index;
    if (previousValidIndex !== undefined) {
      const between = state.buckets.slice(previousValidIndex + 1, currentIndex);
      const expected = bucket - state.buckets[previousValidIndex].bucket - 1;
      state.gapDetected = expected > 0
        && between.length === expected
        && between.every((item) => !item.valid);
    }
  }
  return state;
}
