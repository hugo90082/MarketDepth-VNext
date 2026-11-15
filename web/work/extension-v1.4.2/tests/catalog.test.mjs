import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetCatalog } from "../src/lib/catalog.js";

const frame = (symbol, frameId, visible = true) => ({
  frameId,
  identity: { symbolText: `${symbol}USDT`, intervalText: "1", exchangeText: "Binance" },
  indicators: [{ paneOrdinal: 1, name: "Ratio", params: "10", visible, outputs: [{ label: "Ratio", text: "+0.20%", outputIndex: 0 }] }],
});

test("多商品相同指標仍建立不同精確目標", () => {
  const catalog = buildTargetCatalog([frame("BTC", 2), frame("ETH", 3)]);
  assert.equal(catalog.targets.length, 2);
  assert.deepEqual(catalog.targets.map((item) => item.symbol), ["BTC", "ETH"]);
  assert.equal(catalog.ambiguousKeys.length, 0);
});

test("完全相同圖表身分標記模糊而不猜測", () => {
  const catalog = buildTargetCatalog([frame("BTC", 2), frame("BTC", 8)]);
  assert.equal(catalog.targets.length, 0);
  assert.equal(catalog.ambiguousKeys.length, 1);
});

test("隱藏指標留在目錄但標記休眠", () => {
  const catalog = buildTargetCatalog([frame("SOL", 4, false)]);
  assert.equal(catalog.targets.length, 1);
  assert.equal(catalog.targets[0].status, "hidden");
});

test("顯示名稱只包含商品、指標與參數", () => {
  const catalog = buildTargetCatalog([frame("BTC", 2)]);
  assert.equal(catalog.targets[0].displayLabel, "BTC｜Ratio（10）");
  assert.doesNotMatch(catalog.targets[0].displayLabel, /Binance|USDT|｜1｜/);
});

test("中英混合指標移除英文翻譯、裝飾符號與參數標籤", () => {
  const bilingual = frame("BTC", 2);
  bilingual.indicators[0].name = "✦ 聚合現貨訂單薄深度比值 Aggregated Spot Order Book Depth Ratio ✦";
  bilingual.indicators[0].params = "Depth: 10%";
  const [target] = buildTargetCatalog([bilingual]).targets;
  assert.equal(target.displayLabel, "BTC｜聚合現貨訂單薄深度比值（10%）");
  assert.match(target.key, /Aggregated Spot Order Book Depth Ratio/);
  assert.match(target.key, /Depth: 10%/);
});

test("純英文指標保留必要名稱，參數只保留有效數值", () => {
  const englishOnly = frame("ETH", 3);
  englishOnly.indicators[0].name = "◆ RSI ◆";
  englishOnly.indicators[0].params = "Length: 14";
  const [target] = buildTargetCatalog([englishOnly]).targets;
  assert.equal(target.displayLabel, "ETH｜RSI（14）");
});

test("重複中文名稱會合併且不重複顯示參數", () => {
  const duplicateName = frame("SOL", 4);
  duplicateName.indicators[0].name = "聚合現貨訂單薄深度比值 · 聚合現貨訂單薄深度比值（10%）";
  duplicateName.indicators[0].params = "10%";
  const [target] = buildTargetCatalog([duplicateName]).targets;
  assert.equal(target.displayLabel, "SOL｜聚合現貨訂單薄深度比值（10%）");
});

test("只有同名目標衝突時才追加輸出與穩定項次", () => {
  const duplicateOutputs = frame("BTC", 2);
  duplicateOutputs.indicators[0].outputs = [
    { label: "快線", text: "+0.20%", outputIndex: 0 },
    { label: "慢線", text: "+0.10%", outputIndex: 1 },
  ];
  const catalog = buildTargetCatalog([duplicateOutputs]);
  assert.deepEqual(catalog.targets.map((item) => item.displayLabel), [
    "BTC｜Ratio（10）｜快線",
    "BTC｜Ratio（10）｜慢線",
  ]);
});

test("輸出名稱同樣清除英文與符號，無可用名稱時使用穩定項次", () => {
  const outputs = frame("BTC", 2);
  outputs.indicators[0].outputs = [
    { label: "◆ 快線 Fast Line", text: "+0.20%", outputIndex: 0 },
    { label: "Fast Line", text: "+0.10%", outputIndex: 1 },
    { label: "Fast Line", text: "+0.05%", outputIndex: 2 },
  ];
  const catalog = buildTargetCatalog([outputs]);
  assert.deepEqual(catalog.targets.map((item) => item.displayLabel), [
    "BTC｜Ratio（10）｜快線",
    "BTC｜Ratio（10）｜數值 1",
    "BTC｜Ratio（10）｜數值 2",
  ]);
  assert.equal(catalog.targets.some((item) => /Fast Line|◆|輸出/.test(item.displayLabel)), false);
});

test("同名指標各只有一個輸出時省略輸出名稱並顯示固定項次", () => {
  const duplicatedStudies = frame("BTC", 2);
  duplicatedStudies.indicators = [
    {
      paneOrdinal: 1,
      name: "<CoinGlass> 聚合現貨訂單薄深度比值",
      params: "",
      visible: true,
      outputs: [{ label: "Ratio", text: "+0.20", outputIndex: 0 }],
    },
    {
      paneOrdinal: 2,
      name: "<CoinGlass> 聚合現貨訂單薄深度比值",
      params: "",
      visible: true,
      outputs: [{ label: "Ratio", text: "+0.10", outputIndex: 0 }],
    },
  ];
  const catalog = buildTargetCatalog([duplicatedStudies]);
  assert.deepEqual(catalog.targets.map((item) => item.displayLabel), [
    "BTC｜聚合現貨訂單薄深度比值｜第 1 項",
    "BTC｜聚合現貨訂單薄深度比值｜第 2 項",
  ]);
  assert.equal(catalog.targets.some((item) => /Ratio|輸出|待辨識/.test(item.displayLabel)), false);
});
