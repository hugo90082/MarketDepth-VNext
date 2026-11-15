import { normalizeLevels, type Levels } from "./depth-settings.ts";

export type DepthProfileSource = "extension" | "test-site" | "production-site";
export type SharedDepthThresholdProfile = {
  levels: Levels;
  revision: number;
  updatedAt: number;
  source: DepthProfileSource;
};

export const SHARED_DEPTH_PROFILE_KEY = "depthwatch-shared-depth-profile-v2";

const PROFILE_SOURCES = new Set<DepthProfileSource>([
  "extension",
  "production-site",
  "test-site",
]);

function validLevels(value: unknown): value is Levels {
  if (!value || typeof value !== "object") return false;
  const levels = value as Partial<Levels>;
  return typeof levels.level1 === "number"
    && typeof levels.level2 === "number"
    && typeof levels.level3 === "number"
    && levels.level1 > 0
    && levels.level1 < levels.level2
    && levels.level2 < levels.level3
    && levels.level3 <= 0.7;
}

export function normalizeDepthProfile(value: unknown): SharedDepthThresholdProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Partial<SharedDepthThresholdProfile>;
  if (
    !validLevels(profile.levels)
    || !Number.isInteger(profile.revision)
    || Number(profile.revision) < 0
    || typeof profile.updatedAt !== "number"
    || !Number.isFinite(profile.updatedAt)
    || !PROFILE_SOURCES.has(profile.source as DepthProfileSource)
  ) return null;
  return {
    levels: normalizeLevels(profile.levels),
    revision: Number(profile.revision),
    updatedAt: profile.updatedAt,
    source: profile.source as DepthProfileSource,
  };
}
