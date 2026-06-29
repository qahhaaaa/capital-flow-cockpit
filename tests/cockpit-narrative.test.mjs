import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCategories, computeNarrativeSignal, normalizeTrending } from "../src/cockpit/layers/narrative.mjs";

const protocols = [
  { category: "Dexes", tvl: 1000, change_7d: 1, change_1d: 0.2 },
  { category: "Dexes", tvl: 1000, change_7d: 3, change_1d: 0.4 },
  { category: "RWA", tvl: 500, change_7d: 10 },
  { category: "Lending", tvl: 800, change_7d: -6 },
  { category: null, tvl: 999, change_7d: 5 }, // no category -> ignored
];

test("normalize: aggregates TVL by category with TVL-weighted 7d change, sorted by TVL", () => {
  const { perSector } = normalizeCategories(protocols);
  assert.deepEqual(perSector.map((s) => s.sector), ["Dexes", "Lending", "RWA"]);
  const dexes = perSector.find((s) => s.sector === "Dexes");
  assert.equal(dexes.tvl, 2000);
  assert.equal(dexes.change7dPct, 2); // (1*1000 + 3*1000)/2000
});

test("signal: top category rotates in, bottom rotates out, with a sector rotation edge", () => {
  const { perSector } = normalizeCategories(protocols);
  const signal = computeNarrativeSignal(perSector);
  const rwa = signal.components.find((c) => c.sector === "RWA");
  const lending = signal.components.find((c) => c.sector === "Lending");
  const dexes = signal.components.find((c) => c.sector === "Dexes");
  assert.equal(rwa.direction, "rotate_in"); // +10%
  assert.equal(lending.direction, "rotate_out"); // -6%
  assert.equal(dexes.direction, "flat"); // +2% within deadband
  assert.equal(signal.rotationEdges[0].type, "sector");
  assert.equal(signal.rotationEdges[0].from, "Lending");
  assert.equal(signal.rotationEdges[0].to, "RWA");
});

test("normalizeTrending extracts trending coins + categories (attention proxy)", () => {
  const { trendingCoins, trendingCategories } = normalizeTrending({
    coins: [{ item: { symbol: "wif", name: "dogwifhat", market_cap_rank: 50, data: { price_change_percentage_24h: { usd: 12.4 } } } }],
    categories: [{ name: "Memes" }],
  });
  assert.equal(trendingCoins[0].symbol, "WIF");
  assert.equal(trendingCoins[0].change24hPct, 12);
  assert.equal(trendingCategories[0].name, "Memes");
});

test("computeNarrativeSignal attaches mindshare as informational, with a manipulability note", () => {
  const signal = computeNarrativeSignal([], {
    mindshare: { trendingCoins: [{ symbol: "WIF" }], trendingCategories: [{ name: "Memes" }] },
  });
  assert.ok(signal.mindshare);
  assert.equal(signal.mindshare.trendingCoins[0].symbol, "WIF");
  assert.match(signal.mindshare.note, /操纵/);
});
