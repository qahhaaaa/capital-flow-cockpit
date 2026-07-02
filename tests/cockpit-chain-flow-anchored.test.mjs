import test from "node:test";
import assert from "node:assert/strict";

import { anchoredDeltas, computeChainFlowSignal } from "../src/cockpit/layers/chain-flow.mjs";

const ts = (h) => new Date(Date.UTC(2026, 6, 1, h)).toISOString();
const solOnly = (sharePoints) => [{ chain: "solana", label: "SOL", sharePoints }];
const solComp = (signal) => signal.components.find((c) => c.chain === "solana");

test("anchoredDeltas: each delta spans >=4h of real time, not one collection step", () => {
  // 1h cadence, +0.01pp per hour
  const points = Array.from({ length: 13 }, (_, i) => ({ ts: ts(i), share: 5 + i * 0.01 }));
  const { deltas } = anchoredDeltas(points);
  // first anchored point is at h4 (vs h0); every delta ≈ 4 hourly steps
  assert.equal(deltas.length, 9);
  for (const delta of deltas) assert.ok(Math.abs(delta - 0.04) < 1e-9);
});

test("1h cadence: per-step drift hides in the deadband, the 4h-anchored delta does not", () => {
  // +0.01pp/h — adjacent diff (0.01) < FLAT_EPS_PP (0.02) would read "flat";
  // the anchored 4h delta (0.04) correctly reads "inflow".
  const points = Array.from({ length: 13 }, (_, i) => ({ ts: ts(i), share: 5 + i * 0.01 }));
  const comp = solComp(computeChainFlowSignal(solOnly(points)));
  assert.equal(comp.direction, "inflow");
  assert.ok(Math.abs(comp.shareDeltaPp - 0.04) < 1e-9);
  assert.equal(comp.dataQuality, "partial"); // 12h span < 24h — honest partial
});

test("ok quality needs both >=8 anchored deltas and >=24h of coverage", () => {
  const nine4h = Array.from({ length: 9 }, (_, i) => ({ ts: ts(i * 4), share: 5 + i * 0.05 })); // 32h span
  assert.equal(solComp(computeChainFlowSignal(solOnly(nine4h))).dataQuality, "ok");
  const dense = Array.from({ length: 13 }, (_, i) => ({ ts: ts(i), share: 5 + i * 0.05 })); // 9 deltas, 12h span
  assert.equal(solComp(computeChainFlowSignal(solOnly(dense))).dataQuality, "partial");
});

test("cusum inflection flags a slow persistent drift the deadband calls flat", () => {
  // 4h cadence, steps alternating +0.005/+0.01: every anchored delta < 0.02 -> direction flat,
  // but the drift is one-sided -> inflection "up".
  const points = [{ ts: ts(0), share: 5 }];
  for (let i = 1; i < 30; i += 1) {
    points.push({ ts: ts(i * 4), share: points[i - 1].share + (i % 2 ? 0.005 : 0.01) });
  }
  const comp = solComp(computeChainFlowSignal(solOnly(points)));
  assert.equal(comp.direction, "flat");
  assert.equal(comp.inflection, "up");
});

test("timestamped path degrades honestly: empty -> missing, single point -> partial", () => {
  assert.equal(solComp(computeChainFlowSignal(solOnly([]))).dataQuality, "missing");
  const single = solComp(computeChainFlowSignal(solOnly([{ ts: ts(0), share: 5 }])));
  assert.equal(single.dataQuality, "partial");
  assert.equal(single.direction, "unknown");
  assert.equal(single.shareNow, 5);
});

test("legacy plain-series entries keep byte-identical behavior", () => {
  const signal = computeChainFlowSignal([{ chain: "solana", label: "SOL", shareSeries: [5, 5.1] }]);
  const comp = solComp(signal);
  assert.equal(comp.direction, "inflow");
  assert.ok(Math.abs(comp.shareDeltaPp - 0.1) < 1e-9);
  assert.equal(comp.dataQuality, "partial"); // < 8 points, as before
});
