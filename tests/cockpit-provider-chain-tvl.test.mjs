import test from "node:test";
import assert from "node:assert/strict";

import { normalizeChainTvl, loadChainTvlSnapshot, CHAIN_TVL_URL } from "../src/cockpit/providers/chain-tvl.mjs";

// Shape mirrors api.llama.fi/v2/chains (verified live 2026-07-10).
const rawChains = [
  { name: "Ethereum", tvl: 38420000000 },
  { name: "Solana", tvl: 4940000000 },
  { name: "Robinhood Chain", tvl: 90000000 },
  { name: "SomeChain", tvl: null }, // null tvl must be rejected, not coerced to 0
];

const CHAINS = [
  { id: "ethereum", llamaName: "Ethereum" },
  { id: "solana", llamaName: "Solana" },
  { id: "robinhood", llamaName: "Robinhood Chain" },
  { id: "base", llamaName: "Base" }, // absent from feed -> missing
];

test("chain-tvl: matches llamaName (incl. Robinhood Chain), absent chain is honest missing", () => {
  const out = normalizeChainTvl(rawChains, { chains: CHAINS });
  assert.equal(out.find((c) => c.chain === "ethereum").tvlUsd, 38420000000);
  assert.equal(out.find((c) => c.chain === "robinhood").tvlUsd, 90000000);
  const base = out.find((c) => c.chain === "base");
  assert.equal(base.tvlUsd, null);
  assert.equal(base.dataQuality, "missing");
});

test("chain-tvl: snapshot loads via fetchImpl and hits the v2/chains endpoint once", async () => {
  const urls = [];
  const out = await loadChainTvlSnapshot({
    chains: CHAINS,
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => rawChains };
    },
  });
  assert.deepEqual(urls, [CHAIN_TVL_URL]);
  assert.equal(out.source, "defillama-chain-tvl");
  assert.equal(out.perChain.find((c) => c.chain === "solana").tvlUsd, 4940000000);
});
