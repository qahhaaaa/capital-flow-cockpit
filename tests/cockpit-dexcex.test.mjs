import test from "node:test";
import assert from "node:assert/strict";

import { computeDexCexSignal } from "../src/cockpit/layers/dexcex.mjs";

test("positive aggregate funding => money in perps (to_perp); high |funding| => crowded", () => {
  const signal = computeDexCexSignal({
    assets: [
      { symbol: "BTC", spotVol24hUsd: 1e9, perpVol24hUsd: 3e9, funding: 0.0008 },
      { symbol: "ETH", spotVol24hUsd: 5e8, perpVol24hUsd: 2e9, funding: 0.0006 },
      { symbol: "SOL", spotVol24hUsd: 3e8, perpVol24hUsd: 1e9, funding: 0.0007 },
    ],
  });
  assert.equal(signal.direction, "to_perp");
  assert.equal(signal.crowding, "high"); // avg ~0.0007 >= 0.0005
  assert.equal(signal.confidence, "high"); // 3 assets
});

test("negative funding => money toward spot (to_spot), not crowded", () => {
  const signal = computeDexCexSignal({
    assets: [{ symbol: "BTC", spotVol24hUsd: 2e9, perpVol24hUsd: 1e9, funding: -0.0002 }],
  });
  assert.equal(signal.direction, "to_spot");
  assert.equal(signal.crowding, "normal");
});

test("no derivatives data => missing, never a fabricated direction", () => {
  const signal = computeDexCexSignal({ assets: [] });
  assert.equal(signal.direction, "balanced");
  assert.equal(signal.dataQuality, "missing");
});

test("perp-only source (Hyperliquid fallback) => partial, the absent spot view is not overclaimed", () => {
  const signal = computeDexCexSignal({
    assets: [
      { symbol: "BTC", spotVol24hUsd: null, perpVol24hUsd: 3e9, funding: 0.0001 },
      { symbol: "ETH", spotVol24hUsd: null, perpVol24hUsd: 1e9, funding: 0.0001 },
    ],
  });
  assert.equal(signal.direction, "to_perp"); // funding view still real
  assert.equal(signal.perpSpotRatio, null); // no spot leg -> no ratio
  assert.equal(signal.dataQuality, "partial");
});
