import { targetBaseLabel, targetIndicatorLabel } from "./catalog.js";

/** @type {Record<string, [string, string]>} */
const DEPTH_LABELS = {
  buy1: ["買 I", "買盤達到第 1 段"],
  buy2: ["買 II", "買盤達到第 2 段"],
  buy3: ["買 III", "買盤達到第 3 段"],
  sell1: ["賣 I", "賣盤達到第 1 段"],
  sell2: ["賣 II", "賣盤達到第 2 段"],
  sell3: ["賣 III", "賣盤達到第 3 段"],
  "direction-buy": ["負轉正", "由負轉正"],
  "direction-sell": ["正轉負", "由正轉負"],
};

/** @type {Record<string, string>} */
const GENERIC_LABELS = {
  above: "高於或等於",
  below: "低於或等於",
  "cross-up": "上穿",
  "cross-down": "下穿",
};

/** @param {number} value */
export function formatDepthRatio(value) {
  return `${value > 0 ? "+" : ""}${Number(value).toFixed(3)}`;
}

/** @param {any} event @param {any} target @param {string} id */
export function buildAlertRecord(event, target, id = crypto.randomUUID()) {
  const depth = event.mode === "depth-ratio";
  const ratio = depth ? formatDepthRatio(event.value) : String(event.displayValue ?? event.value);
  const depthLabels = DEPTH_LABELS[event.kind];
  const condition = GENERIC_LABELS[event.kind] ?? event.kind;
  const ruleName = depth
    ? `${target.symbol}｜${event.depthLabel}%｜${depthLabels?.[0] ?? event.kind}｜${ratio}`
    : `${target.displayLabel || targetBaseLabel(target)}｜${condition}｜${ratio}`;
  const message = depth
    ? `${depthLabels?.[1] ?? event.kind}｜${ratio}`
    : `${target.displayLabel || targetBaseLabel(target)}｜${condition}｜目前 ${ratio}`;
  const tone = depth
    ? event.kind
    : event.kind === "above" || event.kind === "cross-up" ? "generic-up" : "generic-down";
  return {
    id,
    source: "coinglass-indicator-extension",
    time: event.time,
    ruleId: event.ruleId,
    ruleName,
    symbol: target.symbol,
    exchange: target.exchange,
    interval: target.interval,
    indicator: target.indicator,
    output: target.output,
    displayValue: ratio,
    normalizedValue: event.value,
    ruleKind: event.kind,
    mode: event.mode,
    depthLabel: depth ? event.depthLabel : undefined,
    indicatorLabel: depth ? `${event.depthLabel}%` : targetIndicatorLabel(target),
    tone,
    sound: event.sound,
    notificationEnabled: event.notificationEnabled !== false,
    message,
  };
}
