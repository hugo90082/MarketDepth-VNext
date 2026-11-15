export const DORMANT_RELOAD_INTERVAL_MS = 120_000;

/**
 * @param {{dormantRuleIds:string[], now:number, lastReloadAt:number, paused?:boolean, hasPinnedTab?:boolean}} input
 */
export function shouldReloadDormant(input) {
  if (input.paused || input.hasPinnedTab === false || !input.dormantRuleIds.length) return false;
  return input.lastReloadAt <= 0 || input.now - input.lastReloadAt >= DORMANT_RELOAD_INTERVAL_MS;
}

/** @param {Record<string, any>} states @param {string[]} dormantRuleIds */
export function prepareDormantReload(states, dormantRuleIds) {
  const dormant = new Set(dormantRuleIds);
  return Object.fromEntries(Object.entries(states ?? {}).filter(([ruleId]) => !dormant.has(ruleId)));
}
