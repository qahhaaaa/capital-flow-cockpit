import test from "node:test";
import assert from "node:assert/strict";

import { buildMetricEnvelope, MIN_OK_WINDOW } from "../src/cockpit/envelope.mjs";

test("envelope with finite value and enough history is dataQuality=ok", () => {
  const window = [1, 2, 3, 4, 5, 6, 7, 8];
  const env = buildMetricEnvelope({ value: 8, asOf: "2026-06-19T00:00:00.000Z", window });
  assert.equal(env.value, 8);
  assert.equal(env.asOf, "2026-06-19T00:00:00.000Z");
  assert.equal(env.dataQuality, "ok");
  assert.equal(env.percentile, 100); // 8 is >= all 8 window points
  assert.equal(typeof env.z, "number");
  assert.ok(env.z > 0);
});

test("envelope with short history is dataQuality=partial but still computes stats", () => {
  const env = buildMetricEnvelope({ value: 3, window: [1, 2, 3] });
  assert.ok([1, 2, 3].length < MIN_OK_WINDOW);
  assert.equal(env.dataQuality, "partial");
  assert.equal(env.value, 3);
  assert.equal(env.percentile, 100);
});

test("envelope with missing value is dataQuality=missing and nulls the stats", () => {
  const env = buildMetricEnvelope({ value: undefined, window: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.equal(env.dataQuality, "missing");
  assert.equal(env.value, null);
  assert.equal(env.percentile, null);
  assert.equal(env.z, null);

  // providers emit null for "取不到" — it must read as missing, never as 0
  const envNull = buildMetricEnvelope({ value: null, window: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.equal(envNull.dataQuality, "missing");
  assert.equal(envNull.value, null);
});

test("envelope tolerates empty/absent window", () => {
  const env = buildMetricEnvelope({ value: 10 });
  assert.equal(env.value, 10);
  assert.equal(env.dataQuality, "partial");
  assert.equal(env.percentile, null); // no window to rank against
  assert.equal(env.z, null);
});
