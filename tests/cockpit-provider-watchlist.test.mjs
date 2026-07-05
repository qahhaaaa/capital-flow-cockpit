import test from "node:test";
import assert from "node:assert/strict";

import { loadDynamicWatchlist } from "../src/cockpit/providers/watchlist.mjs";

const pool = ({
  name,
  price = "1.25",
  h24 = "12.5",
  vol24 = "900000",
  reserve = "250000",
  dex = "pumpswap",
  m5 = "1",
  h1 = "2",
  h6 = "3",
  vol6 = "400000",
  buys = "15",
  sells = "8",
  fdv = "1234567",
  marketCap = "765432",
} = {}) => ({
  attributes: {
    name,
    base_token_price_usd: price,
    price_change_percentage: { m5, h1, h6, h24 },
    volume_usd: { h6: vol6, h24: vol24 },
    reserve_in_usd: reserve,
    transactions: { h24: { buys, sells } },
    fdv_usd: fdv,
    market_cap_usd: marketCap,
  },
  relationships: { dex: { data: { id: dex } } },
});

test("GeckoTerminal watchlist filters quality, excludes wrapped/stables, dedups symbols, and maps pump dex", async () => {
  const calls = [];
  const out = await loadDynamicWatchlist({
    chains: [{ id: "solana", label: "SOL", llamaName: "Solana" }],
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({
          data: [
            pool({ name: "SOL / USDC", reserve: "900000", vol24: "1000000" }),
            pool({ name: "WIF / SOL", dex: "pumpswap" }),
            pool({ name: "wif / SOL", price: "2.5", dex: "pumpswap" }),
            pool({ name: "MOON / SOL", dex: "moonshot-v1" }),
            pool({ name: "LOWLIQ / SOL", reserve: "149999", vol24: "900000" }),
            pool({ name: "LOWVOL / SOL", reserve: "250000", vol24: "499999" }),
          ],
        }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /networks\/solana\/trending_pools/);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.perChain.solana.map((entry) => entry.target), ["WIF", "MOON"]);
  assert.equal(out.perChain.solana[0].launchpadTag, "pumpfun");
  assert.equal(out.perChain.solana[1].launchpadTag, "moonshot");
  assert.equal(out.perChain.solana[0].metrics.source, "geckoterminal");
});

test("watchlist numeric guard keeps null, undefined, and empty string as null, never 0", async () => {
  // NOTE: destructuring defaults in pool() silently replace `undefined` inputs with fixture
  // defaults — overwrite attributes AFTER construction so real undefined reaches the provider
  // (the exact hole this test exists to cover).
  const row = pool({
    name: "NULLS / SOL",
    price: null,
    h1: "",
    h6: null,
    h24: "",
    buys: "",
    sells: null,
    fdv: "",
    reserve: "250000",
    vol24: "900000",
  });
  row.attributes.price_change_percentage.m5 = undefined;
  row.attributes.volume_usd.h6 = undefined;
  row.attributes.market_cap_usd = undefined;
  const out = await loadDynamicWatchlist({
    chains: [{ id: "solana", label: "SOL", llamaName: "Solana" }],
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [row] }) }),
  });

  const metrics = out.perChain.solana[0].metrics;
  assert.equal(metrics.priceUsd, null);
  assert.equal(metrics.px5mPct, null);
  assert.equal(metrics.px1hPct, null);
  assert.equal(metrics.px6hPct, null);
  assert.equal(metrics.px24hPct, null);
  assert.equal(metrics.vol6hUsd, null);
  assert.equal(metrics.buys24h, null);
  assert.equal(metrics.sells24h, null);
  assert.equal(metrics.fdvUsd, null);
  assert.equal(metrics.vol24hUsd, 900000);
  assert.equal(metrics.liqUsd, 250000);
});

test("watchlist falls back to CoinGecko for one chain when GeckoTerminal fails and isolates other chains", async () => {
  const chains = [
    { id: "solana", label: "SOL", llamaName: "Solana" },
    { id: "base", label: "Base", llamaName: "Base" },
  ];
  const out = await loadDynamicWatchlist({
    chains,
    fetchImpl: async (url) => {
      if (url.includes("networks/solana")) {
        return { ok: true, json: async () => ({ data: [pool({ name: "WIF / SOL" })] }) };
      }
      if (url.includes("networks/base")) return { ok: false, status: 503, json: async () => ({}) };
      if (url.includes("coins/markets")) {
        return {
          ok: true,
          json: async () => [
            { symbol: "aero", current_price: "0.7", total_volume: "12345", market_cap: null, fully_diluted_valuation: "" },
          ],
        };
      }
      throw new Error(`unexpected url ${url}`);
    },
  });

  assert.deepEqual(out.errors, []);
  assert.equal(out.perChain.solana[0].target, "WIF");
  assert.equal(out.perChain.base[0].target, "AERO");
  assert.equal(out.perChain.base[0].metrics.source, "coingecko");
  assert.equal(out.perChain.base[0].metrics.marketCapUsd, null);
  assert.equal(out.perChain.base[0].metrics.fdvUsd, null);
});