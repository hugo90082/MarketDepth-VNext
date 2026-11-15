import { evaluateDepthPolicy } from "./depth-policy.js";
import { ALERT_REPEAT_SECONDS } from "./settings.js";

const ALERT_REPEAT_MS = ALERT_REPEAT_SECONDS * 1_000;
const DEFAULT_LEVELS = { level1: 0.1, level2: 0.2, level3: 0.4 };

/** @param {any} rule @param {any} sample @param {string} kind @param {string} reason @param {number} now */
function eventFor(rule, sample, kind, reason, now) {
  return {
    ruleId: rule.id,
    targetKey: rule.targetKey,
    mode: rule.mode,
    kind,
    value: sample.value,
    displayValue: sample.displayValue,
    reason,
    time: now,
    depthLabel: rule.mode === "depth-ratio" ? rule.depthLabel : undefined,
    notificationEnabled: rule.mode === "depth-ratio" ? rule.notificationEnabled !== false : true,
    sound: rule.soundEnabled ? kind : "none",
  };
}

/** @param {any} rule @param {{level1:number,level2:number,level3:number}|undefined} globalLevels */
function resolveDepthLevels(rule, globalLevels) {
  const shared = rule.custom ? rule.levels : (globalLevels ?? DEFAULT_LEVELS);
  return rule.custom && rule.splitSides
    ? {
        buy: [rule.buyLevels.level1, rule.buyLevels.level2, rule.buyLevels.level3],
        sell: [rule.sellLevels.level1, rule.sellLevels.level2, rule.sellLevels.level3],
      }
    : {
        buy: [shared.level1, shared.level2, shared.level3],
        sell: [shared.level1, shared.level2, shared.level3],
      };
}

/** @param {any} rule @param {any} sample @param {any} previous @param {number} now */
function evaluateGenericRule(rule, sample, previous, now) {
  const state = previous ?? { previousValue: undefined, active: false, lastAlertAt: 0 };
  const { kind, threshold } = rule.condition;
  const previousValue = typeof state.previousValue === "number" ? state.previousValue : undefined;
  const isStateRule = kind === "above" || kind === "below";
  const matches = kind === "above"
    ? sample.value >= threshold
    : kind === "below"
      ? sample.value <= threshold
      : kind === "cross-up"
        ? previousValue !== undefined && previousValue < threshold && sample.value >= threshold
        : previousValue !== undefined && previousValue > threshold && sample.value <= threshold;
  const events = [];

  if (isStateRule) {
    if (!matches) state.active = false;
    else if (!state.active) {
      state.active = true;
      state.lastAlertAt = now;
      events.push(eventFor(rule, sample, kind, "entered", now));
    } else if (now - Number(state.lastAlertAt || 0) >= ALERT_REPEAT_MS) {
      state.lastAlertAt = now;
      events.push(eventFor(rule, sample, kind, "repeat", now));
    }
  } else if (matches) {
    events.push(eventFor(rule, sample, kind, "crossed", now));
  }
  state.previousValue = sample.value;
  state.lastSampleAt = sample.capturedAt;
  return { state, events };
}

/**
 * @param {{rules:any[], samples:Record<string, any>, states:Record<string, any>, now:number, globalLevels?:any}} input
 */
export function evaluateRules(input) {
  const states = structuredClone(input.states ?? {});
  const events = [];
  for (const rule of input.rules ?? []) {
    if (!rule?.enabled) {
      delete states[rule?.id];
      continue;
    }
    const sample = input.samples?.[rule.targetKey];
    if (!sample || typeof sample.value !== "number" || !Number.isFinite(sample.value)) {
      delete states[rule.id];
      continue;
    }
    const previous = states[rule.id];
    if (previous?.lastSampleAt === sample.capturedAt) continue;

    if (rule.mode === "depth-ratio") {
      const result = evaluateDepthPolicy(
        sample.value,
        resolveDepthLevels(rule, input.globalLevels),
        input.now,
        previous?.policy,
      );
      states[rule.id] = { policy: result.state, lastSampleAt: sample.capturedAt };
      events.push(...result.events.map((kind) => eventFor(rule, sample, kind, "policy", input.now)));
      continue;
    }
    if (rule.mode === "generic") {
      const result = evaluateGenericRule(rule, sample, previous, input.now);
      states[rule.id] = result.state;
      events.push(...result.events);
    }
  }
  return { states, events };
}

export function resetAfterReload() {
  return {};
}
