import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFredSeries,
  buildNetLiquiditySeries,
  computeMacroSignal,
} from "../src/cockpit/layers/macro.mjs";

test("parseFredSeries: single-series CSV -> [{date,value}], '.' is missing", () => {
  const csv = `observation_date,WALCL\n2026-04-01,6000000\n2026-04-08,.\n2026-04-15,6010000`;
  const series = parseFredSeries(csv);
  assert.deepEqual(series, [
    { date: "2026-04-01", value: 6000000 },
    { date: "2026-04-08", value: null },
    { date: "2026-04-15", value: 6010000 },
  ]);
});

test("buildNetLiquiditySeries: merges by date, net = WALCL/1000 - TGA - RRP", () => {
  const series = buildNetLiquiditySeries({
    walcl: [{ date: "2026-04-01", value: 6000000 }, { date: "2026-04-08", value: 6005000 }],
    tga: [{ date: "2026-04-01", value: 800000 }, { date: "2026-04-08", value: 800000 }], // millions
    rrp: [{ date: "2026-04-01", value: 500 }, { date: "2026-04-08", value: 490 }], // billions
  });
  assert.equal(series.length, 2);
  assert.equal(series[0].netLiq, 4700); // 6000 - 800 - 500
  assert.equal(series[1].netLiq, 4715); // 6005 - 800 - 490
});

test("buildNetLiquiditySeries: forward-fills across differing frequencies", () => {
  const series = buildNetLiquiditySeries({
    walcl: [{ date: "2026-04-01", value: 6000000 }, { date: "2026-04-15", value: 6010000 }], // gap on 04-08
    tga: [{ date: "2026-04-01", value: 800000 }, { date: "2026-04-08", value: 790000 }, { date: "2026-04-15", value: 790000 }],
    rrp: [{ date: "2026-04-01", value: 500 }, { date: "2026-04-08", value: 480 }, { date: "2026-04-15", value: 480 }],
  });
  const byDate = Object.fromEntries(series.map((s) => [s.date, s.netLiq]));
  assert.equal(byDate["2026-04-08"], 4730); // WALCL carried 6000, TGA 790, RRP 480
  assert.equal(byDate["2026-04-15"], 4740); // 6010 - 790 - 480
});

test("signal: rising = risk_on (放水), falling = risk_off (收水), flat = neutral", () => {
  const rising = Array.from({ length: 8 }, (_, i) => ({ netLiq: 4700 + i * 10 }));
  const falling = Array.from({ length: 8 }, (_, i) => ({ netLiq: 4700 - i * 10 }));
  const flat = Array.from({ length: 8 }, () => ({ netLiq: 4700 }));
  assert.equal(computeMacroSignal(rising).direction, "risk_on");
  assert.equal(computeMacroSignal(falling).direction, "risk_off");
  assert.equal(computeMacroSignal(flat).direction, "neutral");
  assert.equal(computeMacroSignal(rising).confidence, "high");
});

test("signal: too little data is neutral/missing, never a confident regime call", () => {
  const signal = computeMacroSignal([]);
  assert.equal(signal.direction, "neutral");
  assert.equal(signal.dataQuality, "missing");
});
