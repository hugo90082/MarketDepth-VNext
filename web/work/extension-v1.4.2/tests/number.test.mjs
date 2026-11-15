import test from "node:test";
import assert from "node:assert/strict";
import { parseDisplayNumber } from "../src/lib/number.js";

test("門檻沿用 CoinGlass 顯示單位並標準化縮寫", () => {
  assert.deepEqual(parseDisplayNumber("+0.25%"), { value: 0.25, unit: "%", display: "+0.25%" });
  assert.deepEqual(parseDisplayNumber("1.2K"), { value: 1_200, unit: "number", display: "1.2K" });
  assert.deepEqual(parseDisplayNumber("3.4M"), { value: 3_400_000, unit: "number", display: "3.4M" });
  assert.deepEqual(parseDisplayNumber("1.25億"), { value: 125_000_000, unit: "number", display: "1.25億" });
  assert.equal(parseDisplayNumber("—"), null);
});

test("解析 Unicode 負號、千分位與括號負數", () => {
  assert.equal(parseDisplayNumber("−1,234.5")?.value, -1234.5);
  assert.equal(parseDisplayNumber("(2.5B)")?.value, -2_500_000_000);
});
