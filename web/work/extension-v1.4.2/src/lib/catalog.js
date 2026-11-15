import { parseDisplayNumber } from "./number.js";

/** @param {unknown} value */
function cleanPart(value) {
  return String(value ?? "").trim().replace(/\|/g, "¦");
}

/** @param {unknown} value */
function normalizedDisplayText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[−﹣－]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} value */
function collapseRepeatedParts(value) {
  const parts = value.split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const compact = [];
  for (const part of parts) {
    if (compact.at(-1) !== part) compact.push(part);
  }
  for (let length = 1; length <= Math.floor(compact.length / 2); length += 1) {
    if (compact.length % length !== 0) continue;
    const repeated = compact.every((part, index) => part === compact[index % length]);
    if (repeated) return compact.slice(0, length).join(" ");
  }
  return compact.join(" ");
}

/** @param {unknown} value @param {{preserveEnglish?: boolean}} options */
function cleanDisplayName(value, options = {}) {
  let text = normalizedDisplayText(value);
  const hasChinese = /\p{Script=Han}/u.test(text);
  if (hasChinese) {
    text = text
      .replace(/\([^)]*[A-Za-z][^)]*\)/g, " ")
      .replace(/[A-Za-z][A-Za-z0-9]*(?:[\s_-]+[A-Za-z][A-Za-z0-9]*)*/g, " ");
  } else if (options.preserveEnglish !== true) {
    text = "";
  }
  text = text
    .replace(/[^\p{Script=Han}\p{Number}A-Za-z%+\-.,/\s]/gu, " ")
    .replace(/\s*%\s*/g, "%")
    .replace(/\s*([,./])\s*/g, "$1")
    .replace(/^[,./+-]+|[,./+-]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapseRepeatedParts(text);
}

/** @param {unknown} value */
function cleanDisplayParams(value) {
  const text = normalizedDisplayText(value);
  const matches = [...text.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?/g)];
  if (!matches.length) return "";
  let result = matches[0][0];
  for (let index = 1; index < matches.length; index += 1) {
    const previous = matches[index - 1];
    const between = text.slice((previous.index ?? 0) + previous[0].length, matches[index].index ?? 0);
    const separator = /[/／]/.test(between)
      ? "/"
      : /(?:~|～|\bto\b)/i.test(between) ? "～" : ", ";
    result += `${separator}${matches[index][0]}`;
  }
  return result;
}

/** @param {string} name @param {string} params */
function removeDuplicatedParams(name, params) {
  if (!params || !name.endsWith(params)) return name;
  return name.slice(0, -params.length).replace(/[,./+%-]+$/g, "").trim() || name;
}

/** @param {{symbolText?: string, intervalText?: string, exchangeText?: string}} identity */
export function parseChartIdentity(identity) {
  const symbolText = cleanPart(identity?.symbolText).toUpperCase();
  const match = /^([A-Z0-9]{1,20}?)(USDT|USD)$/.exec(symbolText);
  const interval = cleanPart(identity?.intervalText);
  const exchange = cleanPart(identity?.exchangeText);
  if (!match || !interval || !exchange) return null;
  return { symbol: match[1], quote: match[2], interval, exchange };
}

/** @param {Record<string, unknown>} target */
export function targetKey(target) {
  return [
    target.symbol,
    target.quote,
    target.exchange,
    target.interval,
    target.paneOrdinal,
    target.indicator,
    target.params,
    target.output,
    target.outputIndex,
    target.unit,
  ].map((part) => cleanPart(String(part ?? ""))).join("|");
}

/** @param {Record<string, unknown>} target */
export function targetBaseLabel(target) {
  const symbol = normalizedDisplayText(target?.symbol).toUpperCase().replace(/[^A-Z0-9]/g, "") || "?";
  const params = cleanDisplayParams(target?.params);
  const indicator = removeDuplicatedParams(
    cleanDisplayName(target?.indicator, { preserveEnglish: true }) || "指標",
    params,
  );
  return `${symbol}｜${indicator}${params ? `（${params}）` : ""}`;
}

/** @param {any} target */
export function targetIndicatorLabel(target) {
  const base = String(target?.displayLabel || targetBaseLabel(target)).trim();
  const symbol = normalizedDisplayText(target?.symbol).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const prefix = symbol ? `${symbol}｜` : "";
  return (prefix && base.startsWith(prefix) ? base.slice(prefix.length) : base) || "指標";
}

/** @param {any} target */
function targetOutputLabel(target) {
  return cleanDisplayName(target?.output) || `數值 ${Number(target?.unnamedOutputOrdinal) || Number(target?.outputIndex) + 1}`;
}

/** @param {Array<any>} targets */
function withDisplayLabels(targets) {
  const baseCounts = new Map();
  for (const target of targets) {
    const base = targetBaseLabel(target);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }
  const provisional = targets.map((target) => {
    const base = targetBaseLabel(target);
    const hasMultipleOutputs = Number(target?.outputCount) > 1;
    return {
      ...target,
      displayLabel: (baseCounts.get(base) ?? 0) > 1 && hasMultipleOutputs
        ? `${base}｜${targetOutputLabel(target)}`
        : base,
    };
  });
  const labelCounts = new Map();
  for (const target of provisional) {
    labelCounts.set(target.displayLabel, (labelCounts.get(target.displayLabel) ?? 0) + 1);
  }
  const ordinals = new Map();
  return provisional.map((target) => {
    if ((labelCounts.get(target.displayLabel) ?? 0) < 2) return target;
    const ordinal = (ordinals.get(target.displayLabel) ?? 0) + 1;
    ordinals.set(target.displayLabel, ordinal);
    return {
      ...target,
      displayLabel: `${target.displayLabel}｜第 ${ordinal} 項`,
    };
  });
}

/** @param {Array<any>} targets */
export function applyTargetDisplayLabels(targets) {
  return withDisplayLabels(Array.isArray(targets) ? targets : []);
}

/**
 * @param {Array<any>} frames
 */
export function buildTargetCatalog(frames) {
  /** @type {Array<any>} */
  const candidates = [];
  const errors = [];
  for (const [fallbackChartOrdinal, frame] of (Array.isArray(frames) ? frames : []).entries()) {
    const chartOrdinal = Number.isInteger(frame?.chartOrdinal)
      ? Number(frame.chartOrdinal)
      : fallbackChartOrdinal;
    const identity = parseChartIdentity(frame?.identity);
    if (!identity) {
      errors.push({ frameId: frame?.frameId, reason: "無法辨識主圖身分" });
      continue;
    }
    const paneOrdinals = new Map();
    for (const indicator of Array.isArray(frame?.indicators) ? frame.indicators : []) {
      const paneOrdinal = Number(indicator?.paneOrdinal) || 0;
      const nextIndicatorOrdinal = paneOrdinals.get(paneOrdinal) ?? 0;
      const indicatorOrdinal = Number.isInteger(indicator?.indicatorOrdinal)
        ? Number(indicator.indicatorOrdinal)
        : nextIndicatorOrdinal;
      paneOrdinals.set(paneOrdinal, Math.max(nextIndicatorOrdinal, indicatorOrdinal) + 1);
      let unnamedOutputOrdinal = 0;
      for (const output of Array.isArray(indicator?.outputs) ? indicator.outputs : []) {
        const parsed = parseDisplayNumber(output?.text);
        if (!parsed) continue;
        const outputName = cleanPart(output?.label || `輸出 ${Number(output?.outputIndex) + 1}`);
        const outputHasDisplayName = Boolean(cleanDisplayName(outputName));
        if (!outputHasDisplayName) unnamedOutputOrdinal += 1;
        /** @type {any} */
        const candidate = {
          ...identity,
          frameId: frame.frameId,
          chartOrdinal,
          paneOrdinal,
          indicatorOrdinal,
          indicator: cleanPart(indicator?.name),
          params: cleanPart(indicator?.params),
          outputCount: Array.isArray(indicator?.outputs) ? indicator.outputs.length : 0,
          output: outputName,
          outputIndex: Number(output?.outputIndex) || 0,
          unnamedOutputOrdinal: outputHasDisplayName ? 0 : unnamedOutputOrdinal,
          unit: parsed.unit,
          displayValue: parsed.display,
          value: parsed.value,
          status: indicator?.visible === false ? "hidden" : "ok",
          catalogOrdinal: candidates.length,
        };
        candidate.key = targetKey(candidate);
        candidates.push(candidate);
      }
    }
  }

  const counts = new Map();
  for (const item of candidates) counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
  const ambiguousKeys = [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const ambiguous = new Set(ambiguousKeys);
  return {
    targets: applyTargetDisplayLabels(
      candidates.filter((item) => !ambiguous.has(item.key)),
    ),
    ambiguousKeys,
    errors,
  };
}

/** @param {any} source @param {any} candidate */
export function compatibleTarget(source, candidate) {
  return source?.indicator === candidate?.indicator
    && source?.params === candidate?.params
    && source?.output === candidate?.output
    && source?.unit === candidate?.unit;
}
