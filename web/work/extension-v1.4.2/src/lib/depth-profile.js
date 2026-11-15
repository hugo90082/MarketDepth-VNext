import { normalizeLevels } from "./settings.js";

/** @type {Record<string, number>} */
const SOURCE_ORDER = { extension: 3, "production-site": 2, "test-site": 1 };

/** @param {any} left @param {any} right */
export function selectNewestDepthProfile(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (Number(left.updatedAt) !== Number(right.updatedAt)) {
    return Number(left.updatedAt) > Number(right.updatedAt) ? left : right;
  }
  if (Number(left.revision) !== Number(right.revision)) {
    return Number(left.revision) > Number(right.revision) ? left : right;
  }
  return (SOURCE_ORDER[left.source] ?? 0) >= (SOURCE_ORDER[right.source] ?? 0) ? left : right;
}

/** @param {any} current @param {any} levels @param {string} source @param {number} now */
export function createUpdatedDepthProfile(current, levels, source, now = Date.now()) {
  if (!Object.hasOwn(SOURCE_ORDER, source)) throw new Error("不支援的全域門檻來源");
  return {
    levels: normalizeLevels(levels),
    revision: Math.max(0, Math.trunc(Number(current?.revision) || 0)) + 1,
    updatedAt: now,
    source,
  };
}
