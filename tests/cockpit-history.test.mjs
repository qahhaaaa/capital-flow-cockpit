import test from "node:test";
import assert from "node:assert/strict";

import {
  appendCockpitHistory,
  buildHistoryEntry,
  buildShareSeries,
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
