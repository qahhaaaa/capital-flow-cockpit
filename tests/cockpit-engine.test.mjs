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
