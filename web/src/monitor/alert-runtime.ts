import {
  evaluateAlertPolicy,
  type AlertEvent,
  type AlertPolicyState,
} from "./alert-policy.ts";
import { resolveAlertLevels } from "./depth-settings.ts";
import type {
  AlertConfig,
  AlertLogEntry,
  AlertLogTone,
  AlertLogType,
  Levels,
} from "./depth-settings.ts";

const ERROR_LOG_COOLDOWN_MS = 10 * 60 * 1000;

type AlertRuntimeOptions = {
  getLevels: () => Levels;
  isLeader: () => boolean;
  channelsEnabled: () => boolean;
  onLog: (entry: AlertLogEntry) => void;
  playSound: (symbol: string, events: readonly AlertEvent[]) => void;
  sendNotification: (message: string) => void;
  now?: () => number;
};

function ratio(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

export function createAlertRuntime(options: AlertRuntimeOptions) {
  const now = options.now ?? Date.now;
  const policyStates = new Map<string, AlertPolicyState>();
  const generatedAt = new Map<string, number>();
  const errorLoggedAt = new Map<string, number>();
  let sequence = 0;

  const appendLog = (
    symbol: string,
    type: AlertLogType,
    message: string,
    tone?: AlertLogTone,
    details: Pick<AlertLogEntry, "depthLabel" | "displayValue"> = {},
  ) => {
    const time = now();
    const entry: AlertLogEntry = {
      id: `${time}-${++sequence}`,
      time,
      symbol,
      type,
      message,
      tone,
      ...details,
    };
    options.onLog(entry);
    return entry;
  };

  const notify = (
    symbol: string,
    type: "threshold" | "direction",
    message: string,
    config: AlertConfig,
    tone: AlertEvent,
    depthLabel: number,
    displayValue: string,
  ) => {
    if (!options.isLeader()) return;
    appendLog(symbol, type, message, tone, { depthLabel, displayValue });
    if (!options.channelsEnabled()) return;
    if (config.notification) options.sendNotification(message);
  };

  return {
    checkpoint: () => ({policy:[...policyStates],snapshots:[...generatedAt],errors:[...errorLoggedAt],sequence}),
    restore: (value:unknown) => {
      const saved=value as {policy?:[string,AlertPolicyState][];snapshots?:[string,number][];errors?:[string,number][];sequence?:number};
      if(!saved||!Array.isArray(saved.policy)||!Array.isArray(saved.snapshots))return;
      policyStates.clear();generatedAt.clear();errorLoggedAt.clear();
      for(const [key,state]of saved.policy)if(typeof key==='string'&&state?.armed&&Number.isFinite(state.last)&&[-1,0,1].includes(state.stableSign))policyStates.set(key,state);
      for(const [key,time]of saved.snapshots)if(typeof key==='string'&&Number.isFinite(time))generatedAt.set(key,time);
      for(const [key,time]of saved.errors??[])if(typeof key==='string'&&Number.isFinite(time))errorLoggedAt.set(key,time);
      sequence=Number.isFinite(saved.sequence)?saved.sequence!:sequence;
    },
    acceptSnapshot: (symbol: string, nextGeneratedAt: number) => {
      if (generatedAt.get(symbol) === nextGeneratedAt) return false;
      generatedAt.set(symbol, nextGeneratedAt);
      return true;
    },
    setSequence: (value: number) => {
      sequence = Math.max(0, Math.floor(value));
    },
    appendLog,
    resetPolicy: (symbol?: string) => {
      if (symbol) policyStates.delete(symbol);
      else policyStates.clear();
    },
    onSourceModeChange: (symbol: string) => {
      void symbol;
      // The caller skips the transition snapshot. Preserve arming, direction,
      // level-one dwell time, and the 60-second repeat clock for the next
      // stable snapshot so a partial/full source change cannot re-fire alerts.
    },
    removeSymbol: (symbol: string) => {
      policyStates.delete(symbol);
      generatedAt.delete(symbol);
      for (const key of errorLoggedAt.keys()) {
        if (key.startsWith(`${symbol}:`)) errorLoggedAt.delete(key);
      }
    },
    recordError: (
      symbol: string,
      key: string,
      message: string,
      cooldownMs = ERROR_LOG_COOLDOWN_MS,
    ) => {
      if (!options.isLeader()) return false;
      const time = now();
      const last = errorLoggedAt.get(key);
      if (last !== undefined && time - last < cooldownMs) return false;
      errorLoggedAt.set(key, time);
      appendLog(symbol, "error", message);
      return true;
    },
    evaluate: (
      symbol: string,
      value: number | null,
      success: number,
      complete: number,
      config: AlertConfig,
      depthLabel: number,
    ) => {
      if (!config.enabled || value === null || success < 1) {
        policyStates.delete(symbol);
        return [] as AlertEvent[];
      }
      const levels = resolveAlertLevels(config, options.getLevels());
      const result = evaluateAlertPolicy(
        value,
        {
          buy: [levels.buy.level1, levels.buy.level2, levels.buy.level3],
          sell: [levels.sell.level1, levels.sell.level2, levels.sell.level3],
        },
        now(),
        policyStates.get(symbol),
      );
      for (const event of result.events) {
        if (event === "direction-buy" || event === "direction-sell") {
          const message = `${event === "direction-buy" ? "由負轉正" : "由正轉負"}｜${ratio(value)}｜來源 ${success}（完整 ${complete}）`;
          notify(symbol, "direction", message, config, event, depthLabel, ratio(value));
          continue;
        }
        const tier = event.endsWith("3") ? 3 : event.endsWith("2") ? 2 : 1;
        const message = `${event.startsWith("buy") ? "買盤" : "賣盤"}達到第 ${tier} 段｜${ratio(value)}｜來源 ${success}（完整 ${complete}）`;
        notify(symbol, "threshold", message, config, event, depthLabel, ratio(value));
      }
      if (
        result.events.length
        && options.isLeader()
        && options.channelsEnabled()
        && config.sound
      ) options.playSound(symbol, result.events);
      policyStates.set(symbol, result.state);
      return result.events;
    },
  };
}
