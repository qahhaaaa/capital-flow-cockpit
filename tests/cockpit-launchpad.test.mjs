import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeLaunchpadFees,
  computeLaunchpadSignal,
} from "../src/cockpit/layers/launchpad.mjs";

// Shape mirrors api.llama.fi/overview/fees (dataType=dailyRevenue): { protocols: [...] }
const rawFees = {
  protocols: [
    { name: "Pump.fun", total24h: 3_000_000, total7d: 14_000_000, total30d: 40_000_000 },
    { name: "four.meme", total24h: 1_000_000, total7d: 7_000_000, total30d: 30_000_000 },
  ],
};

test("normalize: matches configured launchpads by name; absent launchpad is missing not 0", () => {
  const { perLaunchpad } = normalizeLaunchpadFees(rawFees);
  const pump = perLaunchpad.find((l) => l.launchpad === "pumpfun");
  const bonk = perLaunchpad.find((l) => l.launchpad === "letsbonk");
  assert.equal(pump.revenue24h, 3_000_000);
  assert.equal(pump.chain, "solana");
  assert.equal(pump.dataQuality, "ok");
  assert.equal(bonk.revenue24h, null); // not present in feed
  assert.equal(bonk.dataQuality, "missing");
});

test("signal: 24h revenue above the 7d daily average = heating, below = cooling", () => {
  const signal = computeLaunchpadSignal([
    { launchpad: "pumpfun", label: "pump.fun", chain: "solana", revenue24h: 3_000_000, revenue7d: 14_000_000, dataQuality: "ok" },
    { launchpad: "letsbonk", label: "LetsBonk", chain: "solana", revenue24h: 500_000, revenue7d: 7_000_000, dataQuality: "ok" },
    { launchpad: "fourmeme", label: "four.meme", chain: "bsc", revenue24h: 1_000_000, revenue7d: 7_000_000, dataQuality: "ok" },
  ]);

  assert.equal(signal.layer, "launchpad");
  const pump = signal.components.find((c) => c.launchpad === "pumpfun");
  const bonk = signal.components.find((c) => c.launchpad === "letsbonk");
  const four = signal.components.find((c) => c.launchpad === "fourmeme");
  assert.equal(pump.direction, "heating"); // 3.0M vs 2.0M/day -> +50%
  assert.equal(bonk.direction, "cooling"); // 0.5M vs 1.0M/day -> -50%
  assert.equal(four.direction, "flat"); // 1.0M vs 1.0M/day -> 0

  assert.equal(signal.direction, "heating");
  assert.equal(signal.rotationEdges[0].type, "launchpad");
  assert.equal(signal.rotationEdges[0].to, "pumpfun");
  assert.equal(signal.rotationEdges[0].from, "letsbonk");

  // enrichment: chain rollup + leader
  assert.equal(signal.topLaunchpad.launchpad, "pumpfun"); // highest 24h revenue
  const sol = signal.byChain.find((c) => c.chain === "solana");
  const bsc = signal.byChain.find((c) => c.chain === "bsc");
  assert.equal(sol.revenue24h, 3_500_000); // pump 3M + letsbonk 0.5M
  assert.equal(bsc.revenue24h, 1_000_000); // four.meme
});

test("signal: missing launchpad data stays unknown, never fabricated", () => {
  const signal = computeLaunchpadSignal([
    { launchpad: "pumpfun", label: "pump.fun", chain: "solana", revenue24h: null, revenue7d: null, dataQuality: "missing" },
  ]);
  const pump = signal.components.find((c) => c.launchpad === "pumpfun");
  assert.equal(pump.direction, "unknown");
  assert.equal(pump.momentum, null);
  assert.equal(pump.strength, null);
});
