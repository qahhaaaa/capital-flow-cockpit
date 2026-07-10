import test from "node:test";
import assert from "node:assert/strict";

import { loadChainDexVolumeSnapshot, parseVolSeries } from "../src/cockpit/providers/chain-volume.mjs";

test("parseVolSeries keeps trailing 14 valid daily points, drops malformed ones, never fakes 0", () => {
  const chart = [];
  for (let i = 0; i < 20; i += 1) chart.push([1751000000 + i * 86400, (i + 1) * 1e6]);
  chart.push([1753000000, null]); // 缺量的一天 → 丢弃,不当 0
  const series = parseVolSeries(chart);
  assert.equal(series.length, 13); // 尾 14 行里 1 行缺量被丢 → 13 根柱(诚实少一根,不补 0)
  assert.equal(series.at(-1).v, 20e6);
  assert.ok(series.every((p) => Number.isFinite(p.t) && Number.isFinite(p.v)));
  assert.deepEqual(parseVolSeries(null), []);
  assert.deepEqual(parseVolSeries("nope"), []);
});

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