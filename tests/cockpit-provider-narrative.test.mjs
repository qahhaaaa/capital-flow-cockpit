import test from "node:test";
import assert from "node:assert/strict";

import { loadCategoriesSnapshot } from "../src/cockpit/providers/narrative.mjs";

const protocols = [
  { category: "RWA", tvl: 500, change_7d: 10 },
  { category: "Lending", tvl: 800, change_7d: -6 },
];

test("loads /protocols and aggregates into per-sector momentum", async () => {
  const out = await loadCategoriesSnapshot({ fetchImpl: async () => ({ ok: true, json: async () => protocols }) });
  assert.equal(out.source, "defillama-categories");
  assert.ok(out.perSector.some((s) => s.sector === "RWA"));
});

test("throws on non-ok response", async () => {
  await assert.rejects(loadCategoriesSnapshot({ fetchImpl: async () => ({ ok: false, status: 500 }) }), /500/);
});
