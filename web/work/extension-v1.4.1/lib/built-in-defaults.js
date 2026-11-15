export const BUILT_IN_DEFAULTS_VERSION = 1;

const INDICATOR = "<CoinGlass> 聚合現貨訂單薄深度比值";

/** @typedef {{level1:number,level2:number,level3:number}} Levels */
/** @param {number} level1 @param {number} level2 @param {number} level3 @returns {Levels} */
const shared = (level1, level2, level3) => ({ level1, level2, level3 });

/**
 * @param {string} templateId
 * @param {string} symbol
 * @param {number} depthLabel
 * @param {number} paneOrdinal
 * @param {Levels} levels
 * @param {Levels} buyLevels
 * @param {Levels} sellLevels
 * @param {boolean} splitSides
 */
function entry(templateId, symbol, depthLabel, paneOrdinal, levels, buyLevels, sellLevels, splitSides) {
  return {
    templateId,
    target: {
      symbol,
      interval: "1",
      indicator: INDICATOR,
      params: "",
      output: "Ratio",
      outputIndex: 0,
      unit: "number",
      paneOrdinal,
    },
    rule: {
      mode: "depth-ratio",
      enabled: true,
      soundEnabled: true,
      notificationEnabled: true,
      depthLabel,
      splitSides,
      levels,
      buyLevels,
      sellLevels,
    },
  };
}

const threeShared = shared(0.1, 0.2, 0.3);
const solCommon = shared(0.2, 0.4, 0.55);
const solBuy = shared(0.2, 0.4, 0.5);
const solSell = shared(0.001, 0.1, 0.2);
const majorTen = shared(0.4, 0.55, 0.6);
const majorTenSell = shared(0.1, 0.2, 0.4);

export const BUILT_IN_DEFAULT_RULES = Object.freeze([
  entry("depthwatch-built-in-1", "BTC", 3, 1, threeShared, threeShared, threeShared, false),
  entry("depthwatch-built-in-2", "ETH", 3, 1, threeShared, threeShared, threeShared, false),
  entry("depthwatch-built-in-3", "SOL", 3, 1, solCommon, solBuy, solSell, true),
  entry("depthwatch-built-in-4", "SOL", 10, 2, solCommon, solBuy, solSell, true),
  entry("depthwatch-built-in-5", "ETH", 10, 2, majorTen, majorTen, majorTenSell, true),
  entry("depthwatch-built-in-6", "BTC", 10, 2, majorTen, majorTen, majorTenSell, true),
]);

function cloneEntries() {
  return BUILT_IN_DEFAULT_RULES.map((candidate) => ({
    templateId: candidate.templateId,
    target: { ...candidate.target },
    rule: {
      ...candidate.rule,
      levels: { ...candidate.rule.levels },
      buyLevels: { ...candidate.rule.buyLevels },
      sellLevels: { ...candidate.rule.sellLevels },
    },
  }));
}

/** @param {any} state */
export function ensureBuiltInDefaults(state) {
  const currentVersion = Math.max(0, Math.trunc(Number(state?.preferences?.builtInDefaultsVersion) || 0));
  if (currentVersion >= BUILT_IN_DEFAULTS_VERSION) return { changed: false, state };

  const rules = Array.isArray(state?.rules) ? state.rules : [];
  const pending = Array.isArray(state?.pendingRuleTemplates) ? state.pendingRuleTemplates : [];
  const shouldSeed = rules.length === 0 && pending.length === 0;
  return {
    changed: true,
    state: {
      ...state,
      rules,
      pendingRuleTemplates: shouldSeed ? cloneEntries() : pending,
      preferences: {
        ...(state?.preferences ?? {}),
        builtInDefaultsVersion: BUILT_IN_DEFAULTS_VERSION,
      },
    },
  };
}
