import test from "node:test";
import assert from "node:assert/strict";

import { loadStablecoinChainsSnapshot } from "../src/cockpit/providers/stablecoins.mjs";

const raw = [
  { name: "Solana", totalCirculatingUSD: { peggedUSD: 14_824_000_000 } },
  { name: "Ethereum", totalCirculatingUSD: { peggedUSD: 156_908_000_000 } },
];

test("loads and normalizes stablecoinchains via injected fetch", async () => {
  const out = await loadStablecoinChainsSnapshot({
    fetchImpl: async () => ({ ok: true, json: async () => raw }),
  });
  assert.equal(out.source, "defillama-stablecoinchains");
  const sol = out.perChain.find((c) => c.chain === "solana");
  assert.equal(sol.stablecoinUsd, 14_824_000_000);
});

test("throws on non-ok response (e.g. paywall/error), so collect marks the source failed", async () => {
  await assert.rejects(
    loadStablecoinChainsSnapshot({ fetchImpl: async () => ({ ok: false, status: 402 }) }),
    /402/,
  );
});
