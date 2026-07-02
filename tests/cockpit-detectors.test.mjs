import test from "node:test";
import assert from "node:assert/strict";

import { cusum, emaGap, resampleByTime } from "../src/cockpit/stats.mjs";

const ts = (h) => new Date(Date.UTC(2026, 6, 1, h)).toISOString();

test("resampleByTime picks the latest point at or before each grid slot", () => {
  const points = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((h) => ({ ts: ts(h), v: h }));
  // 4h grid over 8h span -> slots at 0h/4h/8h -> latest values 0, 4, 8
  assert.deepEqual(resampleByTime(points, { stepMs: 4 * 3600e3 }), [0, 4, 8]);
});

test("resampleByTime carries the last known value across gaps instead of dropping slots", () => {
  const points = [{ ts: ts(0), v: 10 }, { ts: ts(1), v: 11 }, { ts: ts(9), v: 20 }];
  // slots 0h/4h/8h: 4h and 8h have no fresh point -> latest earlier value (11) repeats
  assert.deepEqual(resampleByTime(points, { stepMs: 4 * 3600e3 }), [10, 11, 11]);
});

test("resampleByTime rejects invalid input honestly", () => {
  assert.deepEqual(resampleByTime([], { stepMs: 3600e3 }), []);
  assert.deepEqual(resampleByTime([{ ts: "not-a-date", v: 1 }], { stepMs: 3600e3 }), []);
  assert.deepEqual(resampleByTime([{ ts: ts(0), v: 1 }], { stepMs: 0 }), []);
});

test("emaGap: rising series yields a positive gap, flat series ~zero", () => {
  const rising = [1, 1, 1, 1, 1, 2, 3, 4, 5, 6];
  const { gapPct } = emaGap(rising, { fastN: 2, slowN: 5 });
  assert.ok(gapPct > 0);
  const flat = Array(10).fill(3);
  assert.equal(emaGap(flat, { fastN: 2, slowN: 5 }).gapPct, 0);
});

test("emaGap returns nulls before the slow window is filled (no seeded-EMA overclaim)", () => {
  assert.deepEqual(emaGap([1, 2, 3], { fastN: 2, slowN: 5 }), { fast: null, slow: null, gapPct: null });
});

test("cusum alarms on a persistent drift whose every step is small", () => {
  // ten flat points, then steady small positive steps: per-step deadbands see nothing,
  // the cumulative drift is unmistakable.
  const values = [...Array(10).fill(5)];
  for (let i = 1; i <= 10; i += 1) values.push(5 + i * 0.1);
  assert.equal(cusum(values).alarm, "up");
  const falling = [...Array(10).fill(5)];
  for (let i = 1; i <= 10; i += 1) falling.push(5 - i * 0.1);
  assert.equal(cusum(falling).alarm, "down");
});

test("cusum stays silent on constant series and insufficient data", () => {
  assert.equal(cusum(Array(30).fill(7)).alarm, null); // zero variance -> no fake alarm
  assert.deepEqual(cusum([1, 2, 3]), { alarm: null, sPos: null, sNeg: null, stepsSinceAlarm: null });
});

test("cusum winsorises a lone outlier step (gap-compression artifact) instead of alarming", () => {
  // gentle noise, then ONE huge jump (a stalled collector forward-filled, days compressed
  // into one slot), then gentle noise again: persistent-drift detector must stay quiet.
  const values = [];
  for (let i = 0; i < 15; i += 1) values.push(100 + (i % 2 ? 0.01 : -0.01));
  values.push(110); // single compressed jump
  for (let i = 0; i < 15; i += 1) values.push(110 + (i % 2 ? 0.01 : -0.01));
  assert.equal(cusum(values).alarm, null);
});

test("cusum reports alarm staleness so callers can drop weeks-old 'inflections'", () => {
  const drift = [...Array(10).fill(5)];
  for (let i = 1; i <= 10; i += 1) drift.push(5 + i * 0.1);
  const fresh = cusum(drift);
  assert.equal(fresh.alarm, "up");
  assert.ok(fresh.stepsSinceAlarm <= 3); // fired near the tail
  const stale = cusum([...drift, ...Array(150).fill(6)]); // ~25 days of flat afterwards
  assert.equal(stale.alarm, "up"); // raw detector still remembers...
  assert.ok(stale.stepsSinceAlarm >= 140); // ...but staleness exposes it as history
});

test("resampleByTime rejects null/empty values instead of coercing them to 0", () => {
  const points = [
    { ts: "2026-07-01T00:00:00.000Z", v: 100 },
    { ts: "2026-07-01T04:00:00.000Z", v: null },
    { ts: "2026-07-01T08:00:00.000Z", v: 110 },
  ];
  // null point dropped -> its slot forward-fills the last REAL value, never a fake 0
  assert.deepEqual(resampleByTime(points, { stepMs: 4 * 3600e3 }), [100, 100, 110]);
});
