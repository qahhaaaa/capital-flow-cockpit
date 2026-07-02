import test from "node:test";
import assert from "node:assert/strict";

import { computeStableTideSignal } from "../src/cockpit/layers/stable-tide.mjs";

const ts = (h) => new Date(Date.UTC(2026, 6, 1, h)).toISOString();
const B = 1e9;

test("tide: no points -> missing, single point -> partial with mcap shown", () => {
  const empty = computeStableTideSignal([]);
  assert.equal(empty.dataQuality, "missing");
  assert.equal(empty.direction, "unknown");
  const single = computeStableTideSignal([{ ts: ts(0), totalUsd: 300 * B }]);
  assert.equal(single.dataQuality, "partial");
  assert.equal(single.mcapUsd, 300 * B);
});

test("tide: 24h coverage gives direction but stays partial until the 7d detectors go live", () => {
  // 4h cadence, +0.3B per step (~0.1%) over 32h
  const points = Array.from({ length: 9 }, (_, i) => ({ ts: ts(i * 4), totalUsd: 300 * B + i * 0.3 * B }));
  const tide = computeStableTideSignal(points);
  assert.equal(tide.direction, "inflow");
  assert.ok(tide.delta24hPct > 0.05);
  assert.equal(tide.delta7dPct, null); // series does not reach back 7d — never extrapolated
  assert.equal(tide.dataQuality, "partial"); // 7d/EMA/CUSUM fields still null -> honest partial
  assert.equal(tide.points, 9);
});

test("tide: ok quality once both 24h and 7d anchors are reachable", () => {
  // 4h cadence over 8 days (49 points)
  const points = Array.from({ length: 49 }, (_, i) => ({ ts: ts(i * 4), totalUsd: 300 * B + i * 0.1 * B }));
  const tide = computeStableTideSignal(points);
  assert.equal(tide.direction, "inflow");
  assert.ok(tide.delta7dPct > 0);
  assert.equal(tide.dataQuality, "ok");
});

test("tide: burn -> outflow; drift inside the deadband -> flat", () => {
  const burning = Array.from({ length: 9 }, (_, i) => ({ ts: ts(i * 4), totalUsd: 300 * B - i * 0.3 * B }));
  assert.equal(computeStableTideSignal(burning).direction, "outflow");
  const still = Array.from({ length: 9 }, (_, i) => ({ ts: ts(i * 4), totalUsd: 300 * B + i * 0.01 * B }));
  assert.equal(computeStableTideSignal(still).direction, "flat"); // ~0.027% over 24h < 0.05%
});

test("tide: non-finite and non-positive totals are dropped, not zero-filled", () => {
  const tide = computeStableTideSignal([
    { ts: ts(0), totalUsd: 300 * B },
    { ts: ts(4), totalUsd: null },
    { ts: ts(8), totalUsd: -5 },
    { ts: ts(28), totalUsd: 301 * B },
  ]);
  assert.equal(tide.points, 2);
  assert.ok(tide.delta24hPct > 0); // 24h anchor is the h0 point
});
