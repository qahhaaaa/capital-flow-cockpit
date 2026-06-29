import test from "node:test";
import assert from "node:assert/strict";

import { loadAppRevenueSnapshot } from "../src/cockpit/providers/app-revenue.mjs";

const chains = [
  { id: "solana", label: "SOL", llamaName: "Solana" },
  { id: "base", label: "Base", llamaName: "Base" },
];

test("loads per-chain app revenue via injected fetch and isolates one-chain failures", async () => {
  const urls = [];
  const out = await loadAppRevenueSnapshot({
    chains,
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("/Solana?")) {
        return {
          ok: true,
          json: async () => ({ protocols: [{ name: "Pump.fun", total24h: 3_000_000, total7d: 14_000_000 }] }),
        };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });

  assert.equal(out.source, "defillama-chain-fees");
  assert.equal(urls.length, 2);
  assert.equal(urls[0].includes("/overview/fees/Solana?"), true);
  assert.equal(urls[1].includes("/overview/fees/Base?"), true);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].chain, "base");

  const sol = out.perChainApps.find((c) => c.chain === "solana");
  const base = out.perChainApps.find((c) => c.chain === "base");
  assert.equal(sol.topApps[0].protocol, "Pump.fun");
  assert.equal(sol.topApps[0].revenue24h, 3_000_000);
  assert.equal(base.dataQuality, "missing");
  assert.equal(base.totalRevenue24h, null);
});
