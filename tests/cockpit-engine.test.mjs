import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFlowState,
  computePositionGuidance,
  TIER,
} from "../src/cockpit/engine.mjs";

const macro = (direction, extra = {}) => ({
  layer: "macro",
  direction,
  strength: 60,
  confidence: "high",
  dataQuality: "ok",
  ...extra,
});
const chainInflow = {
  layer: "chain",
  direction: "rotating",
  confidence: "high",
  dataQuality: "ok",
  components: [{ chain: "solana", label: "SOL", direction: "inflow", strength: 80, dataQuality: "ok" }],
  rotationEdges: [{ from: "ethereum", to: "solana", type: "chain", strength: 30, confidence: "high" }],
};
const launchpadHeating = {
  layer: "launchpad",
  direction: "heating",
  confidence: "high",
  dataQuality: "ok",
  components: [{ launchpad: "pumpfun", label: "pump.fun", direction: "heating", strength: 90, dataQuality: "ok" }],
  rotationEdges: [],
};

test("flowState: macro direction maps to regime and rotation edges aggregate across layers", () => {
  const state = computeFlowState({ macro: macro("risk_on"), chain: chainInflow, launchpad: launchpadHeating });
  assert.equal(state.regime, "risk_on");
  assert.ok(state.rotationEdges.some((e) => e.from === "ethereum" && e.to === "solana"));
  assert.ok(["aligned_up", "aligned_down", "mixed"].includes(state.agreement.net));
});

test("flowState: missing macro => regime unknown", () => {
  const state = computeFlowState({ chain: chainInflow });
  assert.equal(state.regime, "unknown");
});

test("guidance: pump rule — heating launchpad in non-risk_off floors tier at >= probe", () => {
  const guidance = computePositionGuidance(
    { launchpad: launchpadHeating },
    [{ target: "WIF", type: "onchain_spot", chainTag: "solana", launchpadTag: "pumpfun" }],
    { regime: "neutral" },
  );
  const row = guidance[0];
  assert.notEqual(row.tier, TIER.FLAT);
  assert.ok(row.tailwindLayers.some((t) => t.layer === "launchpad"));
});

test("guidance: risk_off regime caps tier at probe even with strong tailwinds", () => {
  const guidance = computePositionGuidance(
    { chain: chainInflow, launchpad: launchpadHeating },
    [{ target: "WIF", type: "onchain_spot", chainTag: "solana", launchpadTag: "pumpfun" }],
    { regime: "risk_off" },
  );
  assert.ok([TIER.FLAT, TIER.PROBE].includes(guidance[0].tier));
});

test("guidance: only headwinds => flat", () => {
  const chainOutflow = {
    layer: "chain",
    direction: "rotating",
    confidence: "high",
    dataQuality: "ok",
    components: [{ chain: "solana", label: "SOL", direction: "outflow", strength: 70, dataQuality: "ok" }],
    rotationEdges: [],
  };
  const guidance = computePositionGuidance(
    { chain: chainOutflow },
    [{ target: "WIF", type: "onchain_spot", chainTag: "solana" }],
    { regime: "neutral" },
  );
  assert.equal(guidance[0].tier, TIER.FLAT);
  assert.ok(guidance[0].headwindLayers.some((h) => h.layer === "chain"));
});

test("guidance: CEX perp crowding raises a risk flag", () => {
  const dexCexCrowded = {
    layer: "dexCex",
    direction: "to_perp",
    strength: 80,
    confidence: "high",
    dataQuality: "ok",
    crowding: "high",
  };
  const guidance = computePositionGuidance(
    { chain: chainInflow, dexCex: dexCexCrowded },
    [{ target: "SOL-PERP", type: "cex_perp", chainTag: "solana" }],
    { regime: "neutral" },
  );
  assert.ok(guidance[0].riskFlags.some((f) => f.includes("拥挤")));
});

test("guidance: on-chain low exit-liquidity raises a risk flag and never silently inflates size", () => {
  const guidance = computePositionGuidance(
    { chain: chainInflow, launchpad: launchpadHeating },
    [{ target: "TINYCOIN", type: "onchain_spot", chainTag: "solana", launchpadTag: "pumpfun", profile: { exitLiquidity: "low" } }],
    { regime: "neutral" },
  );
  assert.ok(guidance[0].riskFlags.some((f) => f.includes("出场流动性")));
});

test("guidance: a target whose layers have no data is conservative, not confident", () => {
  const guidance = computePositionGuidance(
    { chain: { layer: "chain", confidence: "low", dataQuality: "missing", components: [], rotationEdges: [] } },
    [{ target: "RANDOM", type: "onchain_spot", chainTag: "solana" }],
    { regime: "neutral" },
  );
  assert.equal(guidance[0].tier, TIER.FLAT);
  assert.equal(guidance[0].dataQuality, "missing");
});

test("guidance v2: full positive metrics lift conviction above equivalent null metrics", () => {
  const target = { target: "HOT", type: "onchain_spot", chainTag: "solana" };
  const baseline = computePositionGuidance(
    { chain: chainInflow },
    [{ ...target, metrics: null }],
    { regime: "neutral" },
  )[0];
  const withMetrics = computePositionGuidance(
    { chain: chainInflow },
    [{
      ...target,
      metrics: {
        px1hPct: 8,
        px6hPct: 20,
        px24hPct: 60,
        vol24hUsd: 6_000_000,
        liqUsd: 600_000,
        buys24h: 1_200,
        sells24h: 300,
      },
    }],
    { regime: "neutral" },
  )[0];

  assert.ok(withMetrics.conviction > baseline.conviction);
  assert.ok(withMetrics.factors.some((factor) => factor.key === "momentum" && factor.pts > 0));
  assert.ok(withMetrics.factors.some((factor) => factor.key === "flow" && factor.pts > 0));
  assert.ok(withMetrics.factors.some((factor) => factor.key === "turnover" && factor.pts > 0));
});

test("guidance v2: negative momentum pulls conviction below null-metrics baseline", () => {
  const target = { target: "COLD", type: "onchain_spot", chainTag: "solana" };
  const baseline = computePositionGuidance(
    { chain: chainInflow },
    [{ ...target, metrics: null }],
    { regime: "neutral" },
  )[0];
  const withMetrics = computePositionGuidance(
    { chain: chainInflow },
    [{
      ...target,
      metrics: {
        px1hPct: -8,
        px6hPct: -20,
        px24hPct: -60,
      },
    }],
    { regime: "neutral" },
  )[0];

  assert.ok(withMetrics.conviction < baseline.conviction);
  assert.ok(withMetrics.factors.some((factor) => factor.key === "momentum" && factor.pts < 0));
});

test("guidance v2: turnover sweet-zone curve — casino-grade churn scores 0 and raises a risk flag", () => {
  // px=0 / 买卖平衡:让 momentum/flow 都在场但得 0 分,turnover 保持名义权重(0.1/0.4 → 满分 10)
  const mk = (vol, liq) => computePositionGuidance(
    { chain: chainInflow },
    [{ target: "T", type: "onchain_spot", chainTag: "solana", metrics: { px1hPct: 0, px6hPct: 0, px24hPct: 0, buys24h: 600, sells24h: 600, vol24hUsd: vol, liqUsd: liq } }],
    { regime: "neutral" },
  )[0];
  const turnoverPts = (row) => row.factors.find((f) => f.key === "turnover").pts;

  const sweet = mk(10_000_000, 1_000_000); // 10x: 甜区满分
  const decayed = mk(25_000_000, 1_000_000); // 25x: 下坡 1-(10/25)=0.6
  const casino = mk(44_000_000, 1_000_000); // 44x: 归零 + 风险旗
  const cold = mk(300_000, 1_000_000); // 0.3x: 冷,0 分

  assert.equal(turnoverPts(sweet), 10);
  assert.ok(turnoverPts(decayed) > 5.5 && turnoverPts(decayed) < 6.5);
  assert.equal(turnoverPts(casino), 0);
  assert.ok(casino.riskFlags.some((flag) => flag.includes("极端换手")));
  assert.ok(!sweet.riskFlags.some((flag) => flag.includes("极端换手")));
  assert.equal(turnoverPts(cold), 0);
});

test("guidance v2: momentum up-cap — a +120% daily spike scores no higher than +30%, downside uncapped", () => {
  const mk = (px24hPct) => computePositionGuidance(
    { chain: chainInflow },
    [{ target: "T", type: "onchain_spot", chainTag: "solana", metrics: { px24hPct } }],
    { regime: "neutral" },
  )[0];
  const momentumPts = (row) => row.factors.find((f) => f.key === "momentum").pts;

  assert.equal(momentumPts(mk(120)), momentumPts(mk(30))); // 超过 +30% 的部分不再加分
  assert.ok(momentumPts(mk(25)) < momentumPts(mk(30))); // cap 以下仍有区分度
  assert.ok(momentumPts(mk(-120)) < momentumPts(mk(-30))); // 负向不截,跌全额扣
});

test("guidance v2: small-sample fund flow is skipped instead of counted as zero", () => {
  const row = computePositionGuidance(
    { chain: chainInflow },
    [{
      target: "THIN-SAMPLE",
      type: "onchain_spot",
      chainTag: "solana",
      metrics: {
        px1hPct: 4,
        px6hPct: 8,
        px24hPct: 16,
        vol24hUsd: 1_000_000,
        liqUsd: 500_000,
        buys24h: 20,
        sells24h: 10,
      },
    }],
    { regime: "neutral" },
  )[0];

  assert.equal(row.factors.some((factor) => factor.key === "flow"), false);
  assert.ok(row.rationale.includes("资金流样本不足"));
});

test("guidance v2: new metric risk flags trigger and downgrade one tier per risk", () => {
  const strongNarrative = {
    layer: "narrative",
    direction: "rotate_in",
    strength: 100,
    confidence: "high",
    dataQuality: "ok",
    components: [{ sector: "meme", direction: "rotate_in", strength: 100, dataQuality: "ok" }],
  };
  const spotDexCex = {
    layer: "dexCex",
    direction: "to_spot",
    strength: 100,
    confidence: "high",
    dataQuality: "ok",
  };
  const row = computePositionGuidance(
    { chain: chainInflow, launchpad: launchpadHeating, narrative: strongNarrative, dexCex: spotDexCex },
    [{
      target: "CROWDED",
      type: "onchain_spot",
      chainTag: "solana",
      launchpadTag: "pumpfun",
      sectorTag: "meme",
      metrics: {
        px1hPct: 30,
        px6hPct: 70,
        px24hPct: 120,
        vol24hUsd: 4_000_000,
        liqUsd: 200_000,
        buys24h: 2_000,
        sells24h: 200,
      },
    }],
    { regime: "risk_on" },
  )[0];

  assert.ok(row.riskFlags.includes("流动性薄(<$30万)，出场滑点风险"));
  assert.ok(row.riskFlags.includes("单边追高拥挤"));
  assert.equal(row.tier, TIER.PROBE);
});

test("guidance v2: cool-down cap applies last after new factor math and risk tier-downs", () => {
  const row = computePositionGuidance(
    { chain: chainInflow, launchpad: launchpadHeating },
    [{
      target: "HOT-RISK-OFF",
      type: "onchain_spot",
      chainTag: "solana",
      launchpadTag: "pumpfun",
      metrics: {
        px1hPct: 50,
        px6hPct: 100,
        px24hPct: 200,
        vol24hUsd: 10_000_000,
        liqUsd: 2_000_000,
        buys24h: 5_000,
        sells24h: 100,
      },
    }],
    { regime: "risk_off" },
  )[0];

  assert.ok(row.conviction >= 50);
  assert.equal(row.tier, TIER.PROBE);
});

test("guidance v2: missing metrics keeps roughly old layer signal scaled to 60 percent", () => {
  const row = computePositionGuidance(
    { chain: chainInflow },
    [{ target: "NO-METRICS", type: "onchain_spot", chainTag: "solana" }],
    { regime: "neutral" },
  )[0];

  assert.equal(row.conviction, 14);
  assert.ok(row.rationale.includes("标的级数据缺失"));
  assert.deepEqual(row.factors.map((factor) => factor.key), ["layers"]);
});

test("guidance v2: app revenue heat enters layer signal for matching chain", () => {
  const base = computePositionGuidance(
    { chain: chainInflow },
    [{ target: "HEAT", type: "onchain_spot", chainTag: "solana", metrics: null }],
    { regime: "neutral" },
  )[0];
  const heated = computePositionGuidance(
    { chain: chainInflow },
    [{ target: "HEAT", type: "onchain_spot", chainTag: "solana", metrics: null }],
    {
      regime: "neutral",
      appRevenueHeat: {
        byChain: [{
          chain: "solana",
          label: "SOL",
          dataQuality: "ok",
          topApps: [{ protocol: "Hot App", share: 100, momentum: 1, direction: "heating" }],
        }],
      },
    },
  )[0];

  assert.ok(heated.conviction > base.conviction);
  assert.ok(heated.tailwindLayers.some((item) => item.layer === "链活动热度"));
});
