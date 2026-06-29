import test from "node:test";
import assert from "node:assert/strict";

import { loadFredNetLiquiditySnapshot } from "../src/cockpit/providers/macro.mjs";

const byId = {
  WALCL: `observation_date,WALCL\n2026-04-01,6000000\n2026-04-08,6005000`,
  WTREGEN: `observation_date,WTREGEN\n2026-04-01,800000\n2026-04-08,800000`,
  RRPONTSYD: `observation_date,RRPONTSYD\n2026-04-01,500\n2026-04-08,490`,
};

test("fetches each FRED series separately and merges into a net-liquidity series", async () => {
  const out = await loadFredNetLiquiditySnapshot({
    fetchImpl: async (url) => {
      const id = Object.keys(byId).find((k) => url.includes(k));
      return { ok: true, text: async () => byId[id] };
    },
  });
  assert.equal(out.source, "fred-net-liquidity");
  assert.equal(out.series.length, 2);
  assert.equal(out.latest.netLiq, 4715); // 6005 - 800 - 490
});

test("throws if any FRED series fails", async () => {
  await assert.rejects(
    loadFredNetLiquiditySnapshot({ fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /503/,
  );
});
