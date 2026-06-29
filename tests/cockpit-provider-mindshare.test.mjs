import test from "node:test";
import assert from "node:assert/strict";

import { loadMindshareSnapshot } from "../src/cockpit/providers/mindshare.mjs";

const raw = {
  coins: [
    { item: { symbol: "siren", name: "Siren", market_cap_rank: 1200, data: { price_change_percentage_24h: { usd: 131.2 } } } },
    { item: { symbol: "pengu", name: "Pudgy Penguins", market_cap_rank: 60, data: { price_change_percentage_24h: { usd: -5.1 } } } },
  ],
  categories: [{ name: "AI Agents" }, { name: "Memes" }],
};

test("loads CoinGecko trending via injected getJson and normalizes coins + categories", async () => {
  const out = await loadMindshareSnapshot({ getJson: async () => raw });
  assert.equal(out.source, "coingecko-trending");
  assert.equal(out.trendingCoins[0].symbol, "SIREN");
  assert.equal(out.trendingCoins[0].change24hPct, 131); // rounded
  assert.equal(out.trendingCategories[0].name, "AI Agents");
});
