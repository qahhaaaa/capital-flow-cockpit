import test from "node:test";
import assert from "node:assert/strict";

import { loadOkxDerivativesSnapshot } from "../src/cockpit/providers/dexcex.mjs";

// getJson is the proxy-aware JSON fetcher (injected here so the test runs offline).
const getJson = async (url) => {
  if (url.includes("funding-rate")) return { code: "0", data: [{ fundingRate: "0.0008" }] };
  if (url.includes("SWAP")) return { code: "0", data: [{ volCcy24h: "30000", last: "100000" }] }; // perp ticker: base×last
  if (url.includes("ticker")) return { code: "0", data: [{ volCcy24h: "1000000000" }] }; // spot ticker
  throw new Error("unexpected url");
};

test("fetches OKX spot/perp tickers + funding via injected getJson and normalizes per asset", async () => {
  const out = await loadOkxDerivativesSnapshot({
    getJson,
    assets: [{ symbol: "BTC", spot: "BTC-USDT", perp: "BTC-USDT-SWAP" }],
  });
  assert.equal(out.source, "okx-derivatives");
  assert.equal(out.assets[0].funding, 0.0008);
  assert.equal(out.assets[0].spotVol24hUsd, 1e9);
  assert.equal(out.assets[0].perpVol24hUsd, 3e9);
});

test("throws when OKX returns a non-zero code", async () => {
  await assert.rejects(
    loadOkxDerivativesSnapshot({
      getJson: async () => ({ code: "50011", data: [] }),
      assets: [{ symbol: "BTC", spot: "BTC-USDT", perp: "BTC-USDT-SWAP" }],
    }),
    /code 50011/,
  );
});
