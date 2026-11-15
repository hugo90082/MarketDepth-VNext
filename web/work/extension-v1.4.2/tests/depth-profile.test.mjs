import assert from "node:assert/strict";
import test from "node:test";
import {
  createUpdatedDepthProfile,
  selectNewestDepthProfile,
} from "../src/lib/depth-profile.js";

const profile = (updatedAt, revision, source = "extension") => ({
  levels: { level1: 0.2, level2: 0.4, level3: 0.55 },
  revision,
  updatedAt,
  source,
});

test("共用門檻以最近修改時間優先並以 revision 解決同時間", () => {
  assert.equal(selectNewestDepthProfile(profile(100, 9), profile(101, 1)).updatedAt, 101);
  assert.equal(selectNewestDepthProfile(profile(100, 1), profile(100, 2)).revision, 2);
});

test("建立本機修改會驗證門檻並增加 revision", () => {
  const updated = createUpdatedDepthProfile(profile(100, 3), { level1: 0.1, level2: 0.3, level3: 0.6 }, "test-site", 200);
  assert.deepEqual(updated, {
    levels: { level1: 0.1, level2: 0.3, level3: 0.6 },
    revision: 4,
    updatedAt: 200,
    source: "test-site",
  });
  assert.throws(() => createUpdatedDepthProfile(profile(100, 3), { level1: 0.4, level2: 0.3, level3: 0.6 }, "test-site", 200));
});
