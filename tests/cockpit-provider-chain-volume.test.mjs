import test from "node:test";
import assert from "node:assert/strict";

import { loadChainDexVolumeSnapshot } from "../src/cockpit/providers/chain-volume.mjs";

test("loads DeFiLlama dexs overview with real observed total24h and change_1d fields", async () => {
  const calls = [];
  const out = await loadChainDexVolumeSnapshot({
    chains: [
      { id: "solana", label: "SOL", llamaName: "Solana" },
      { id: "base", label: "Base", llamaName: "Base" },
    ],
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("/Solana?")) {
        return { ok: true, json: async () => ({ chain: "Solana", total24h: 2_082_717_808, change_1d: 18.59 }) };
      }
      return { ok: false, status: 502, json: async () => ({}) };
    },
  });

  assert.equal(out.source, "defillama-dexs");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /overview\/dexs\/Solana\?/);
  const sol = out.perChain.find((entry) => entry.chain === "solana");
  const base = out.perChain.find((entry) => entry.chain === "base");
  assert.equal(sol.dexVol24hUsd, 2_082_717_808);
  assert.equal(sol.dexVolChange1dPct, 18.59);
  assert.equal(base.dexVol24hUsd, null);
  assert.equal(base.dexVolChange1dPct, null);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].chain, "base");
});

test("chain-volume numeric guard never coerces null or empty fields to 0", async () => {
  const out = await loadChainDexVolumeSnapshot({
    chains: [{ id: "solana", label: "SOL", llamaName: "Solana" }],
    fetchImpl: async () => ({ ok: true, json: async () => ({ total24h: null, change_1d: "" }) }),
  });

  assert.equal(out.perChain[0].dexVol24hUsd, null);
  assert.equal(out.perChain[0].dexVolChange1dPct, null);
  assert.deepEqual(out.errors, []);
});