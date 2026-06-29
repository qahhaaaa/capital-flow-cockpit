import test from "node:test";
import assert from "node:assert/strict";

import { loadLaunchpadFeesSnapshot } from "../src/cockpit/providers/launchpad.mjs";

const raw = { protocols: [{ name: "Pump.fun", total24h: 3_000_000, total7d: 14_000_000 }] };

test("loads and normalizes launchpad fees via injected fetch", async () => {
  const out = await loadLaunchpadFeesSnapshot({
    fetchImpl: async () => ({ ok: true, json: async () => raw }),
  });
  assert.equal(out.source, "defillama-launchpad-fees");
  const pump = out.perLaunchpad.find((l) => l.launchpad === "pumpfun");
  assert.equal(pump.revenue24h, 3_000_000);
});

test("throws on non-ok response", async () => {
  await assert.rejects(
    loadLaunchpadFeesSnapshot({ fetchImpl: async () => ({ ok: false, status: 500 }) }),
    /500/,
  );
});
