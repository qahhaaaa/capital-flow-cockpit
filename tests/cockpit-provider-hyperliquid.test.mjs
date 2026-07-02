import test from "node:test";
import assert from "node:assert/strict";

import { loadHyperliquidDerivativesSnapshot } from "../src/cockpit/providers/hyperliquid.mjs";

// Fixture mirrors the live payload shape verified 2026-07-03: [meta, assetCtxs], index-aligned,
// with a decoy asset between the majors to prove alignment is by name lookup, not position.
const fixture = [
  { universe: [{ name: "BTC" }, { name: "DECOY" }, { name: "SOL" }] },
  [
    { funding: "0.0000125", openInterest: "36655.7", markPx: "61459.0", oraclePx: "61443.0", dayNtlVlm: "3031688236.5" },
    { funding: "0.9", openInterest: "1", markPx: "1", dayNtlVlm: "1" },
    { funding: "-0.0000200", openInterest: "5980897.28", markPx: "80.649", dayNtlVlm: "452390395.8" },
  ],
];

const fetchOk = async () => ({ ok: true, json: async () => fixture });

test("hyperliquid provider maps funding to 8h-equivalent, OI to USD, and keeps spot null", async () => {
  const { source, assets } = await loadHyperliquidDerivativesSnapshot({
    fetchImpl: fetchOk,
    symbols: ["BTC", "SOL"],
  });
  assert.equal(source, "hyperliquid-derivatives");
  assert.equal(assets.length, 2);

  const btc = assets.find((a) => a.symbol === "BTC");
  assert.ok(Math.abs(btc.funding - 0.0000125 * 8) < 1e-12); // hourly ×8 = OKX 8h convention
  assert.ok(Math.abs(btc.oiUsd - 36655.7 * 61459.0) < 1);
  assert.ok(Math.abs(btc.perpVol24hUsd - 3031688236.5) < 1);
  assert.equal(btc.spotVol24hUsd, null); // no spot leg -> null, never fabricated

  const sol = assets.find((a) => a.symbol === "SOL");
  assert.ok(sol.funding < 0); // sign preserved through the ×8 scaling
});

test("hyperliquid provider drops absent symbols instead of zero-filling them", async () => {
  const { assets } = await loadHyperliquidDerivativesSnapshot({
    fetchImpl: fetchOk,
    symbols: ["BTC", "NOPE", "SOL"],
  });
  assert.deepEqual(assets.map((a) => a.symbol), ["BTC", "SOL"]);
});

test("hyperliquid provider throws on HTTP error and on unexpected payload shape", async () => {
  await assert.rejects(
    loadHyperliquidDerivativesSnapshot({ fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /HTTP 503/,
  );
  await assert.rejects(
    loadHyperliquidDerivativesSnapshot({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    /unexpected payload shape/,
  );
});
