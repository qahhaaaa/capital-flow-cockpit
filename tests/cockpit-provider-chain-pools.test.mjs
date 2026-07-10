import test from "node:test";
import assert from "node:assert/strict";

import { aggregateTopPools, loadChainTopPoolsSnapshot } from "../src/cockpit/providers/chain-pools.mjs";

// Shape mirrors api.geckoterminal.com/api/v2/networks/{net}/pools (verified live 2026-07-10).
const rawPools = {
  data: [
    { attributes: { name: "B20 / USDT", volume_usd: { h24: "638500000" }, reserve_in_usd: "2300000" } },
    { attributes: { name: "quq / USDT", volume_usd: { h24: "452400000" }, reserve_in_usd: "5400000" } },
    { attributes: { name: "LAB / USDT", volume_usd: { h24: "133700000" }, reserve_in_usd: "3000000" } },
    // missing reserve -> skipped, never counted as 0
    { attributes: { name: "GHOST / USDT", volume_usd: { h24: "99000000" }, reserve_in_usd: null } },
  ],
};

test("chain-pools: aggregates top pools volume/liquidity/turnover, skips incomplete pools", () => {
  const out = aggregateTopPools(rawPools, { id: "bsc" });
  assert.equal(out.chain, "bsc");
  assert.equal(out.poolCount, 3); // GHOST skipped
  assert.equal(out.vol24hUsd, 638500000 + 452400000 + 133700000);
  assert.equal(out.liqUsd, 2300000 + 5400000 + 3000000);
  assert.equal(out.turnover, Number((out.vol24hUsd / out.liqUsd).toFixed(2)));
  assert.equal(out.topPools.length, 3);
  assert.equal(out.topPools[0].name, "B20 / USDT");
  assert.equal(out.dataQuality, "ok");
});

test("chain-pools: empty/unusable response is honest missing, not zeros", () => {
  const out = aggregateTopPools({ data: [] }, { id: "base" });
  assert.equal(out.vol24hUsd, null);
  assert.equal(out.turnover, null);
  assert.equal(out.dataQuality, "missing");
});

test("chain-pools: unmapped chain (robinhood) degrades to missing without fetch; HTTP error isolated", async () => {
  const calls = [];
  const out = await loadChainTopPoolsSnapshot({
    gapMs: 0,
    chains: [
      { id: "robinhood", label: "Robinhood" },
      { id: "bsc", label: "BSC" },
    ],
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("/bsc/")) return { ok: true, json: async () => rawPools };
      throw new Error(`unexpected fetch ${url}`);
    },
  });
  assert.equal(calls.length, 1); // robinhood never fetched
  const rh = out.perChain.find((c) => c.chain === "robinhood");
  assert.equal(rh.dataQuality, "missing");
  assert.equal(rh.vol24hUsd, null);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0].message, /unsupported GeckoTerminal chain robinhood/);
  const bsc = out.perChain.find((c) => c.chain === "bsc");
  assert.equal(bsc.dataQuality, "ok");
});

test("chain-pools: fetches sequentially (never concurrent) and retries once on 429", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let bscHits = 0;
  const out = await loadChainTopPoolsSnapshot({
    gapMs: 0,
    chains: [
      { id: "solana", label: "SOL" },
      { id: "bsc", label: "BSC" },
    ],
    fetchImpl: async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (url.includes("/bsc/")) {
        bscHits += 1;
        if (bscHits === 1) return { ok: false, status: 429 }; // first hit rate-limited
        return { ok: true, json: async () => rawPools };
      }
      return { ok: true, json: async () => rawPools };
    },
  });
  assert.equal(maxInFlight, 1); // strictly serial — the whole point of the 429 fix
  assert.equal(bscHits, 2); // one retry after 429
  assert.equal(out.perChain.find((c) => c.chain === "bsc").dataQuality, "ok");
  assert.equal(out.errors.length, 0);
});
