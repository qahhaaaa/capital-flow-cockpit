import test from "node:test";
import assert from "node:assert/strict";

import { assembleCockpit } from "../src/cockpit/contract.mjs";

const layerSignals = {
  macro: { layer: "macro", direction: "neutral", strength: 50, confidence: "medium", dataQuality: "ok", rotationEdges: [] },
  chain: {
    layer: "chain",
    direction: "rotating",
    confidence: "high",
    dataQuality: "ok",
    components: [{ chain: "solana", label: "SOL", direction: "inflow", strength: 80, dataQuality: "ok" }],
    rotationEdges: [{ from: "ethereum", to: "solana", type: "chain", strength: 30, confidence: "high" }],
  },
};

test("assembleCockpit produces a v2 contract with regime, layers, flowState, guidance, dataHealth", () => {
  const out = assembleCockpit({
    layerSignals,
    watchlist: [{ target: "WIF", type: "onchain_spot", chainTag: "solana" }],
    meta: { generatedAt: "2026-06-19T00:00:00.000Z" },
    sourceStatus: [{ source: "defillama-stablecoinchains", status: "ok" }],
  });

  assert.equal(out.schema, "cockpit/v2");
  assert.equal(out.meta.generatedAt, "2026-06-19T00:00:00.000Z");
  assert.equal(out.regime, "neutral");
  assert.ok(out.layers.chain);
  assert.ok(out.flowState.rotationEdges.some((e) => e.to === "solana"));
  assert.equal(out.guidance.length, 1);
  assert.equal(out.guidance[0].target, "WIF");
  assert.ok(Array.isArray(out.dataHealth.layers));
  assert.ok(out.dataHealth.layers.some((l) => l.layer === "chain"));
  assert.ok(typeof out.advisory === "string" && out.advisory.includes("不构成下单"));
});

test("assembleCockpit degrades safely with no signals", () => {
  const out = assembleCockpit({ layerSignals: {}, watchlist: [] });
  assert.equal(out.schema, "cockpit/v2");
  assert.equal(out.regime, "unknown");
  assert.deepEqual(out.guidance, []);
});
