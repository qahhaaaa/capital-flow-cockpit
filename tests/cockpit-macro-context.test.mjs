import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildMacroChartModel } from "../public/macro-context-chart.js";

const macroContextPath = new URL("../public/data/macro-context.json", import.meta.url);

test("macro-context data follows macro-context/v1 and keeps sourced numeric points", async () => {
  const data = JSON.parse(await readFile(macroContextPath, "utf8"));

  assert.equal(data.schema, "macro-context/v1");
  assert.ok(data.updatedAt);
  assert.ok(typeof data.disclaimer === "string" && data.disclaimer.length > 0);
  assert.ok(Array.isArray(data.charts) && data.charts.length > 0);

  for (const chart of data.charts) {
    assert.ok(chart.id, "chart.id is required");
    assert.ok(chart.title, `${chart.id}: title is required`);
    assert.ok(chart.unit, `${chart.id}: unit is required`);
    assert.ok(Array.isArray(chart.sources) && chart.sources.length > 0, `${chart.id}: sources are required`);
    assert.ok(Array.isArray(chart.series) && chart.series.length > 0, `${chart.id}: series are required`);

    for (const series of chart.series) {
      assert.ok(series.label, `${chart.id}: series label is required`);
      assert.ok(Array.isArray(series.points) && series.points.length > 0, `${chart.id}/${series.label}: points are required`);
      for (const point of series.points) {
        assert.ok(point.t, `${chart.id}/${series.label}: point.t is required`);
        assert.equal(typeof point.v, "number", `${chart.id}/${series.label}/${point.t}: point.v must be numeric`);
        assert.ok(Number.isFinite(point.v), `${chart.id}/${series.label}/${point.t}: point.v must be finite`);
      }
    }
  }
});

test("buildMacroChartModel lays out discrete x ticks and preserves estimate/disputed flags", () => {
  const model = buildMacroChartModel({
    id: "sample",
    series: [
      {
        label: "A",
        points: [
          { t: "2024", v: 10 },
          { t: "2025", v: 20, estimate: true },
        ],
      },
      {
        label: "B",
        points: [
          { t: "2024", v: 15, disputed: true },
          { t: "2025", v: 25 },
        ],
      },
    ],
  });

  assert.deepEqual(model.ticks.map((tick) => tick.label), ["2024", "2025"]);
  assert.equal(model.series.length, 2);
  assert.match(model.series[0].path, /^M /);
  assert.equal(model.series[0].points[1].estimate, true);
  assert.equal(model.series[1].points[0].disputed, true);
  assert.ok(model.yMin < 10);
  assert.ok(model.yMax > 25);
});

test("buildMacroChartModel orders x ticks chronologically across formats and mismatched series", () => {
  // quarters: lexical sort would wrongly put 1Q26 before 3Q25
  const mem = buildMacroChartModel({
    id: "m",
    series: [{ label: "NAND", points: [{ t: "3Q25", v: 100 }, { t: "4Q25", v: 107 }, { t: "1Q26", v: 169 }, { t: "2Q26E", v: 292 }] }],
  });
  assert.deepEqual(mem.ticks.map((t) => t.label), ["3Q25", "4Q25", "1Q26", "2Q26E"]);

  // two series with interleaved YYYY-MM labels (the ai-arr case) — must be time-sorted, not by appearance
  const arr = buildMacroChartModel({
    id: "a",
    series: [
      { label: "OpenAI", points: [{ t: "2023-12", v: 2 }, { t: "2025-07", v: 12 }, { t: "2026-02", v: 25 }] },
      { label: "Anthropic", points: [{ t: "2024-01", v: 0.087 }, { t: "2026-04", v: 30 }] },
    ],
  });
  assert.deepEqual(arr.ticks.map((t) => t.label), ["2023-12", "2024-01", "2025-07", "2026-02", "2026-04"]);
});