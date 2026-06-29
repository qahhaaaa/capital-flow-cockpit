import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeStablecoinChains,
  computeChainFlowSignal,
} from "../src/cockpit/layers/chain-flow.mjs";

// Shape mirrors stablecoins.llama.fi/stablecoinchains (verified free API).
const rawChains = [
  { name: "Ethereum", totalCirculatingUSD: { peggedUSD: 156_908_000_000 } },
  { name: "Tron", totalCirculatingUSD: { peggedUSD: 89_417_000_000 } },
  { name: "Solana", totalCirculatingUSD: { peggedUSD: 14_824_000_000 } },
  { name: "BSC", totalCirculatingUSD: { peggedUSD: 14_217_000_000 } },
  { name: "Base", totalCirculatingUSD: { peggedUSD: 4_854_000_000 } },
];

test("normalize: maps llamaName to chain id and computes share of global supply", () => {
  const { perChain, totalUsd } = normalizeStablecoinChains(rawChains);
  assert.equal(totalUsd, 280_220_000_000);

  const sol = perChain.find((c) => c.chain === "solana");
  assert.equal(sol.stablecoinUsd, 14_824_000_000);
  assert.ok(Math.abs(sol.share - 5.29) < 0.05); // 14.824 / 280.22
  assert.equal(sol.dataQuality, "ok");
  assert.deepEqual(
    perChain.map((c) => c.chain),
    ["solana", "base", "ethereum", "bsc"],
  );
});

test("normalize: a chain absent from the feed is missing, never 0", () => {
  const { perChain } = normalizeStablecoinChains(rawChains.filter((c) => c.name !== "Base"));
  const base = perChain.find((c) => c.chain === "base");
  assert.equal(base.stablecoinUsd, null);
  assert.equal(base.share, null);
  assert.equal(base.dataQuality, "missing");
});

test("chain-flow signal: rising share = inflow, falling = outflow, with a rotation edge", () => {
  const signal = computeChainFlowSignal([
    { chain: "solana", label: "SOL", shareSeries: [4.0, 4.1, 4.2, 4.4, 4.6, 4.8, 5.0, 5.2] },
    { chain: "base", label: "Base", shareSeries: [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5] },
    { chain: "ethereum", label: "ETH 主网", shareSeries: [52, 51.8, 51.5, 51.2, 51, 50.7, 50.4, 50.0] },
    { chain: "bsc", label: "BSC", shareSeries: [4.6, 4.6, 4.6, 4.6, 4.6, 4.6, 4.6, 4.6] },
  ]);

  assert.equal(signal.layer, "chain");
  const sol = signal.components.find((c) => c.chain === "solana");
  const eth = signal.components.find((c) => c.chain === "ethereum");
  const base = signal.components.find((c) => c.chain === "base");
  assert.equal(sol.direction, "inflow");
  assert.equal(eth.direction, "outflow");
  assert.equal(base.direction, "flat");

  assert.equal(signal.rotationEdges.length, 1);
  assert.equal(signal.rotationEdges[0].from, "ethereum");
  assert.equal(signal.rotationEdges[0].to, "solana");
  assert.equal(signal.rotationEdges[0].type, "chain");
  assert.equal(signal.direction, "rotating");
  assert.equal(signal.confidence, "high");
  assert.equal(signal.dataQuality, "ok");
});

test("chain-flow signal: short/absent history degrades confidence and never fabricates 0", () => {
  const signal = computeChainFlowSignal([
    { chain: "solana", label: "SOL", shareSeries: [4.0, 4.2] },
    { chain: "ethereum", label: "ETH 主网", shareSeries: [50.4, 50.0] },
    // base + bsc omitted entirely
  ]);

  const base = signal.components.find((c) => c.chain === "base");
  assert.equal(base.dataQuality, "missing");
  assert.equal(base.shareDeltaPp, null); // not 0
  assert.equal(base.direction, "unknown");

  const sol = signal.components.find((c) => c.chain === "solana");
  assert.equal(sol.direction, "inflow");
  assert.equal(sol.dataQuality, "partial"); // only 2 points
  assert.notEqual(signal.confidence, "high");
});
