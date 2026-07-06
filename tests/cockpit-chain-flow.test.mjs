import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeStablecoinChains,
  computeChainFlowSignal,
  computeChainPersistence,
} from "../src/cockpit/layers/chain-flow.mjs";

test("chain persistence: thin history is honest 积累中; broad+long+slow-follow is 结构性", () => {
  const base = { compositeScore: 0.44, accel1h: 0.2, accel6h: 0.3, dexVolChange1dPct: 20, slowScore: 0.1 };
  assert.equal(computeChainPersistence(base, [{ ts: "0", score: 0.4 }]).label, "积累中");

  const rising = Array.from({ length: 8 }, (_, i) => ({ ts: String(i), score: 0.3 + i * 0.02 }));
  const structural = computeChainPersistence(base, rising, { dexVolChange7dPct: 15 });
  assert.equal(structural.hours, 8); // all 8 points held the sign
  assert.equal(structural.breadth, 4); // 1h/6h/24h/7d all agree
  assert.equal(structural.slowFollow, true);
  assert.equal(structural.label, "结构性(多日)");
});

test("chain persistence: flat composite -> 无显著流向, never a fabricated durability", () => {
  assert.equal(computeChainPersistence({ compositeScore: 0.01 }, []).label, "无显著流向");
});

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

test("chain-flow composite rotation: fires SOL→BSC on flow divergence even when stablecoin share is flat (2026-07-05 bug)", () => {
  // The real miss: SOL cooling (DEX -11%, fees down) vs BSC hot money (DEX +43%, fees +2.9),
  // while stablecoin SUPPLY share barely moved (inside deadband). The old edge keyed on share
  // delta and drew nothing; the composite must draw SOL→BSC, confirmed by the 24h horizon.
  const flat = (b) => [b, b + 0.0002, b + 0.0001, b, b + 0.0003, b, b + 0.0001, b + 0.0002];
  const series = [
    { chain: "solana", label: "SOL", shareSeries: flat(4.98) },
    { chain: "bsc", label: "BSC", shareSeries: flat(4.5) },
  ];
  const signal = computeChainFlowSignal(series, {
    dexVolume: { perChain: [
      { chain: "solana", dexVolChange1dPct: -11 },
      { chain: "bsc", dexVolChange1dPct: 43 },
    ] },
    chainFees: { byChain: [
      { chain: "solana", topApps: [{ protocol: "pump.fun", share: 100, momentum: -0.1 }] },
      { chain: "bsc", topApps: [{ protocol: "four.meme", share: 100, momentum: 2.9 }] },
    ] },
  });
  assert.equal(signal.rotationEdges.length, 1);
  const edge = signal.rotationEdges[0];
  assert.equal(edge.from, "solana");
  assert.equal(edge.to, "bsc");
  assert.equal(edge.stage, "confirmed"); // 24h DEX+fees agree at both ends
  assert.equal(edge.slowFollow, false); // stablecoin supply hasn't followed yet
  assert.equal(signal.direction, "rotating");
});

test("chain-flow composite rotation: fast-only(6h) divergence is an EARLY (unconfirmed) edge", () => {
  const flat = (b) => [b, b, b, b, b, b, b, b];
  const series = [
    { chain: "solana", label: "SOL", shareSeries: flat(4.98) },
    { chain: "bsc", label: "BSC", shareSeries: flat(4.5) },
  ];
  const signal = computeChainFlowSignal(series, {
    chainActivity: { solana: { accel6h: -0.5 }, bsc: { accel6h: 0.6 } },
  });
  assert.equal(signal.rotationEdges.length, 1);
  assert.equal(signal.rotationEdges[0].to, "bsc");
  assert.equal(signal.rotationEdges[0].stage, "early"); // no 24h horizon to confirm yet
});

test("chain-flow composite: missing DEX component is omitted from weights, never treated as zero", () => {
  const signal = computeChainFlowSignal(
    [{ chain: "solana", label: "SOL", shareSeries: [4.0, 4.1, 4.2, 4.4, 4.6, 4.8, 5.0, 5.2] }],
    {
      chainFees: {
        byChain: [
          {
            chain: "solana",
            topApps: [{ protocol: "App", revenue24h: 1000, revenue7d: 14000, share: 100, momentum: -1 }],
          },
        ],
      },
    },
  );

  const sol = signal.components.find((component) => component.chain === "solana");
  assert.equal(sol.dexVolChange1dPct, null); // DEX omitted, NOT coerced to 0
  assert.equal(sol.feesMomentum, -1);
  // fee momentum(-1, weight 0.35) now outweighs the down-weighted stablecoin share(+, 0.20) -> outflow
  assert.equal(sol.direction, "outflow");
});

test("chain-flow enhancement: old call signature remains byte-compatible", () => {
  const series = [
    { chain: "solana", label: "SOL", shareSeries: [4.0, 4.1, 4.2, 4.4, 4.6, 4.8, 5.0, 5.2] },
    { chain: "ethereum", label: "ETH 主网", shareSeries: [52, 51.8, 51.5, 51.2, 51, 50.7, 50.4, 50.0] },
  ];

  assert.deepEqual(computeChainFlowSignal(series), computeChainFlowSignal(series, {}));
});