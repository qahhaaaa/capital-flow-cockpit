import test from "node:test";
import assert from "node:assert/strict";

import {
  appendCockpitHistory,
  buildHistoryEntry,
  buildShareSeries,
  buildShareSeriesWithTs,
  buildTideSeries,
} from "../src/cockpit/history.mjs";

test("buildHistoryEntry captures per-chain share keyed by chain id", () => {
  const entry = buildHistoryEntry({
    ts: "2026-06-19T00:00:00.000Z",
    perChain: [
      { chain: "solana", share: 5.29 },
      { chain: "base", share: 1.73 },
      { chain: "ethereum", share: null }, // missing stays null, not 0
    ],
  });
  assert.equal(entry.ts, "2026-06-19T00:00:00.000Z");
  assert.equal(entry.chainShares.solana, 5.29);
  assert.equal(entry.chainShares.ethereum, null);
});

test("appendCockpitHistory appends and caps length", () => {
  let history = [];
  for (let i = 0; i < 5; i += 1) {
    history = appendCockpitHistory(history, { ts: String(i), chainShares: { solana: i } }, { max: 3 });
  }
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((p) => p.chainShares.solana), [2, 3, 4]);
});

test("buildShareSeries assembles chronological per-chain series, dropping missing points", () => {
  const history = [
    { ts: "1", chainShares: { solana: 5.0, base: 1.5 } },
    { ts: "2", chainShares: { solana: 5.1, base: null } },
    { ts: "3", chainShares: { solana: 5.3, base: 1.6 } },
  ];
  const series = buildShareSeries(history);
  const sol = series.find((s) => s.chain === "solana");
  const base = series.find((s) => s.chain === "base");
  assert.deepEqual(sol.shareSeries, [5.0, 5.1, 5.3]);
  assert.deepEqual(base.shareSeries, [1.5, 1.6]); // null point dropped, never 0
});

test("buildHistoryEntry stores the global total, null when absent or non-finite", () => {
  const withTotal = buildHistoryEntry({ ts: "t", perChain: [], totalUsd: 300e9 });
  assert.equal(withTotal.totalUsd, 300e9);
  assert.equal(buildHistoryEntry({ ts: "t", perChain: [] }).totalUsd, null);
  assert.equal(buildHistoryEntry({ ts: "t", perChain: [], totalUsd: "junk" }).totalUsd, null);
});

test("appendCockpitHistory default cap holds 720 points (~30 days at 1h cadence)", () => {
  let history = [];
  for (let i = 0; i < 725; i += 1) {
    history = appendCockpitHistory(history, { ts: String(i), chainShares: {} });
  }
  assert.equal(history.length, 720);
  assert.equal(history[0].ts, "5"); // oldest points dropped first
});

test("buildShareSeriesWithTs keeps {ts, share} pairs and drops missing shares", () => {
  const history = [
    { ts: "2026-07-01T00:00:00.000Z", chainShares: { solana: 5.0, base: null } },
    { ts: "2026-07-01T01:00:00.000Z", chainShares: { solana: 5.1, base: 1.6 } },
  ];
  const series = buildShareSeriesWithTs(history);
  const sol = series.find((s) => s.chain === "solana");
  const base = series.find((s) => s.chain === "base");
  assert.deepEqual(sol.sharePoints.map((p) => p.share), [5.0, 5.1]);
  assert.equal(sol.sharePoints[0].ts, "2026-07-01T00:00:00.000Z");
  assert.equal(base.sharePoints.length, 1); // null share dropped, never 0
});

test("buildTideSeries starts honestly where totalUsd data starts (old entries dropped)", () => {
  const history = [
    { ts: "1", chainShares: {} }, // pre-tide entry: no totalUsd field
    { ts: "2", chainShares: {}, totalUsd: null },
    { ts: "3", chainShares: {}, totalUsd: 301e9 },
  ];
  assert.deepEqual(buildTideSeries(history), [{ ts: "3", totalUsd: 301e9 }]);
});
