import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeChainAppFees,
  computeAppRevenueSignal,
} from "../src/cockpit/layers/app-revenue.mjs";
import { assembleCockpit } from "../src/cockpit/contract.mjs";

const chains = [
  { id: "solana", label: "SOL", llamaName: "Solana" },
  { id: "base", label: "Base", llamaName: "Base" },
];

test("normalize: sorts top chain apps by 24h revenue and never fills missing chain data with 0", () => {
  const { perChainApps } = normalizeChainAppFees({
    solana: {
      protocols: [
        { name: "App C", total24h: 25, total7d: 175 },
        { name: "App A", total24h: 100, total7d: 700 },
        { name: "App F", total24h: 1, total7d: 7 },
        { name: "App B", total24h: 50, total7d: 350 },
        { name: "App E", total24h: 5, total7d: 35 },
        { name: "App D", total24h: 15, total7d: 105 },
      ],
    },
  }, { chains });

  const sol = perChainApps.find((c) => c.chain === "solana");
  const base = perChainApps.find((c) => c.chain === "base");
  assert.deepEqual(sol.topApps.map((a) => a.protocol), ["App A", "App B", "App C", "App D", "App E"]);
  assert.equal(sol.topApps[0].revenue24h, 100);
  assert.equal(sol.topApps[0].share, 51);
  assert.equal(sol.dataQuality, "ok");
  assert.equal(base.dataQuality, "missing");
  assert.deepEqual(base.topApps, []);
  assert.equal(base.totalRevenue24h, null);
});

test("signal: app revenue heat uses momentum with low-share denoising and flags dominant single-app spikes", () => {
  const signal = computeAppRevenueSignal([
    {
      chain: "solana",
      label: "SOL",
      dataQuality: "ok",
      totalRevenue24h: 100,
      topApps: [
        { protocol: "Dominant App", revenue24h: 80, revenue7d: 560, share: 80 },
        { protocol: "Real Hot App", revenue24h: 19.5, revenue7d: 68.25, share: 19.5 },
        { protocol: "Tiny Spike", revenue24h: 0.5, revenue7d: 0.35, share: 0.5 },
      ],
    },
    { chain: "base", label: "Base", dataQuality: "missing", totalRevenue24h: null, topApps: [] },
  ], { chains });

  const sol = signal.byChain.find((c) => c.chain === "solana");
  assert.equal(signal.layer, "appRevenue");
  assert.equal(signal.dataQuality, "partial");
  assert.equal(signal.note, "协议收入=活动热度,非流动性/净流入");
  assert.equal(sol.singleAppSpike, true);
  assert.equal(sol.dominantApp.protocol, "Dominant App");
  assert.equal(sol.chainHeat, true);

  const hot = sol.topApps.find((a) => a.protocol === "Real Hot App");
  const tiny = sol.topApps.find((a) => a.protocol === "Tiny Spike");
  assert.equal(hot.momentum, 1);
  assert.equal(hot.direction, "heating");
  assert.equal(tiny.momentum, 9);
  assert.equal(tiny.direction, "flat");
});

test("signal: all chains missing returns missing quality and no fabricated app heat", () => {
  const signal = computeAppRevenueSignal([], { chains });
  assert.equal(signal.dataQuality, "missing");
  assert.equal(signal.byChain.every((c) => c.chainHeat === false), true);
  assert.equal(signal.byChain.every((c) => c.dominantApp === null), true);
});

test("contract: appRevenueHeat is top-level auxiliary data and does not enter layers", () => {
  const appRevenueHeat = computeAppRevenueSignal([
    {
      chain: "solana",
      label: "SOL",
      dataQuality: "ok",
      totalRevenue24h: 100,
      topApps: [{ protocol: "Real Hot App", revenue24h: 100, revenue7d: 350, share: 100 }],
    },
  ], { chains: [chains[0]] });

  const out = assembleCockpit({ layerSignals: {}, watchlist: [], appRevenueHeat });
  assert.equal(out.appRevenueHeat.layer, "appRevenue");
  assert.equal(out.layers.appRevenue, undefined);
  assert.equal(out.flowState.regime, "unknown");
  assert.deepEqual(out.guidance, []);
});
