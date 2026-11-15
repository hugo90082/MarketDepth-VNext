export const DEPTH_REPEAT_MS = 60_000;
export const DEPTH_LEVEL1_DELAY_MS = 60_000;
export const DEPTH_SIGN_DEADBAND = 0.01;

export function emptyDepthPolicyState() {
  return {
    armed: { buy1: true, buy2: true, buy3: true, sell1: true, sell2: true, sell3: true },
    last: 0,
    stableSign: 0,
    pendingLevel1: null,
  };
}

/**
 * @param {number} value
 * @param {{buy:number[], sell:number[]}} levels
 * @param {number} now
 * @param {any} previous
 */
export function evaluateDepthPolicy(value, levels, now, previous = emptyDepthPolicyState()) {
  const [buy1, buy2, buy3] = levels.buy;
  const [sell1, sell2, sell3] = levels.sell;
  /** @type {Record<string, boolean>} */
  const active = {
    buy1: value >= buy1,
    buy2: value >= buy2,
    buy3: value >= buy3,
    sell1: value <= -sell1,
    sell2: value <= -sell2,
    sell3: value <= -sell3,
  };
  /** @type {Record<string, boolean>} */
  const armed = { ...previous.armed };
  for (const key of Object.keys(active)) if (!active[key]) armed[key] = true;

  const measuredSign = value > DEPTH_SIGN_DEADBAND ? 1 : value < -DEPTH_SIGN_DEADBAND ? -1 : 0;
  const stableSign = measuredSign || previous.stableSign;
  const directionEvent = previous.stableSign !== 0 && measuredSign !== 0 && measuredSign !== previous.stableSign
    ? measuredSign > 0 ? "direction-buy" : "direction-sell"
    : undefined;
  const order = value >= 0 ? ["buy1", "buy2", "buy3"] : ["sell1", "sell2", "sell3"];
  const firstKey = order[0];
  const crossed = order.filter((key) => !key.endsWith("1") && active[key] && armed[key]);
  if (crossed.length) {
    if (active[firstKey]) armed[firstKey] = false;
    for (const key of crossed) armed[key] = false;
    return {
      state: { armed, last: now, stableSign, pendingLevel1: null },
      events: [...(directionEvent ? [directionEvent] : []), ...crossed],
    };
  }

  const highest = [...order].reverse().find((key) => active[key]);
  if (!highest) {
    return {
      state: { armed, last: 0, stableSign, pendingLevel1: null },
      events: directionEvent ? [directionEvent] : [],
    };
  }
  if (highest.endsWith("1")) {
    if (!armed[firstKey]) {
      return {
        state: { armed, last: previous.last, stableSign, pendingLevel1: null },
        events: directionEvent ? [directionEvent] : [],
      };
    }
    const pendingLevel1 = previous.pendingLevel1?.key === firstKey
      ? previous.pendingLevel1
      : { key: firstKey, since: now };
    if (now - pendingLevel1.since >= DEPTH_LEVEL1_DELAY_MS) {
      armed[firstKey] = false;
      return {
        state: { armed, last: now, stableSign, pendingLevel1: null },
        events: [...(directionEvent ? [directionEvent] : []), firstKey],
      };
    }
    return {
      state: { armed, last: previous.last, stableSign, pendingLevel1 },
      events: directionEvent ? [directionEvent] : [],
    };
  }
  if (now - previous.last >= DEPTH_REPEAT_MS) {
    return {
      state: { armed, last: now, stableSign, pendingLevel1: null },
      events: [...(directionEvent ? [directionEvent] : []), highest],
    };
  }
  return {
    state: { armed, last: previous.last, stableSign, pendingLevel1: null },
    events: directionEvent ? [directionEvent] : [],
  };
}
