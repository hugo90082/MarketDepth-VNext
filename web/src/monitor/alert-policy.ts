export type AlertKey = "buy1" | "buy2" | "buy3" | "sell1" | "sell2" | "sell3";
export type DirectionEvent = "direction-buy" | "direction-sell";
export type AlertEvent = AlertKey | DirectionEvent;
export type AlertThresholds = {
  buy: [number, number, number];
  sell: [number, number, number];
};

export type AlertPolicyState = {
  armed: Record<AlertKey, boolean>;
  last: number;
  stableSign: -1 | 0 | 1;
  pendingLevel1: { key: "buy1" | "sell1"; since: number } | null;
};

export const ALERT_REPEAT_MS = 60_000;
export const LEVEL1_DELAY_MS = 60_000;
export const SIGN_DEADBAND = 0.01;

export function emptyAlertPolicyState(): AlertPolicyState {
  return {
    armed: { buy1: true, buy2: true, buy3: true, sell1: true, sell2: true, sell3: true },
    last: 0,
    stableSign: 0,
    pendingLevel1: null,
  };
}

export function evaluateAlertPolicy(
  value: number,
  levels: [number, number, number] | AlertThresholds,
  now: number,
  previous = emptyAlertPolicyState(),
) {
  const buyLevels = Array.isArray(levels) ? levels : levels.buy;
  const sellLevels = Array.isArray(levels) ? levels : levels.sell;
  const [buy1, buy2, buy3] = buyLevels;
  const [sell1, sell2, sell3] = sellLevels;
  const active: Record<AlertKey, boolean> = {
    buy1: value >= buy1,
    buy2: value >= buy2,
    buy3: value >= buy3,
    sell1: value <= -sell1,
    sell2: value <= -sell2,
    sell3: value <= -sell3,
  };
  const armed = { ...previous.armed };
  const keys = Object.keys(active) as AlertKey[];
  keys.forEach((key) => { if (!active[key]) armed[key] = true; });

  const measuredSign: -1 | 0 | 1 = value > SIGN_DEADBAND ? 1 : value < -SIGN_DEADBAND ? -1 : 0;
  const stableSign = measuredSign || previous.stableSign;
  const directionEvent: DirectionEvent | undefined = previous.stableSign !== 0 && measuredSign !== 0 && measuredSign !== previous.stableSign
    ? measuredSign > 0 ? "direction-buy" : "direction-sell"
    : undefined;

  const order: AlertKey[] = value >= 0 ? ["buy1", "buy2", "buy3"] : ["sell1", "sell2", "sell3"];
  const firstKey = order[0] as "buy1" | "sell1";
  const crossed = order.filter((key) => !key.endsWith("1") && active[key] && armed[key]);
  if (crossed.length) {
    if (active[firstKey]) armed[firstKey] = false;
    crossed.forEach((key) => { armed[key] = false; });
    return { state: { armed, last: now, stableSign, pendingLevel1: null }, events: [...(directionEvent ? [directionEvent] : []), ...crossed] as AlertEvent[] };
  }

  const highest = [...order].reverse().find((key) => active[key]);
  if (!highest) {
    return { state: { armed, last: 0, stableSign, pendingLevel1: null }, events: directionEvent ? [directionEvent] : [] as AlertEvent[] };
  }
  if (highest.endsWith("1")) {
    if (!armed[firstKey]) {
      return { state: { armed, last: previous.last, stableSign, pendingLevel1: null }, events: directionEvent ? [directionEvent] : [] as AlertEvent[] };
    }
    const pendingLevel1 = previous.pendingLevel1?.key === firstKey ? previous.pendingLevel1 : { key: firstKey, since: now };
    if (now - pendingLevel1.since >= LEVEL1_DELAY_MS) {
      armed[firstKey] = false;
      return { state: { armed, last: now, stableSign, pendingLevel1: null }, events: [...(directionEvent ? [directionEvent] : []), firstKey] as AlertEvent[] };
    }
    return { state: { armed, last: previous.last, stableSign, pendingLevel1 }, events: directionEvent ? [directionEvent] : [] as AlertEvent[] };
  }
  if (now - previous.last >= ALERT_REPEAT_MS) {
    return { state: { armed, last: now, stableSign, pendingLevel1: null }, events: [...(directionEvent ? [directionEvent] : []), highest] as AlertEvent[] };
  }
  return { state: { armed, last: previous.last, stableSign, pendingLevel1: null }, events: directionEvent ? [directionEvent] : [] as AlertEvent[] };
}
