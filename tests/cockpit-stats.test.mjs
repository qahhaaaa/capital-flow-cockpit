import test from "node:test";
import assert from "node:assert/strict";

import { mean, stdDev, percentileRank, zScore } from "../src/cockpit/stats.mjs";

test("percentileRank: fraction of window <= value, scaled 0..100", () => {
  assert.equal(percentileRank(30, [10, 20, 30, 40]), 75);
  assert.equal(percentileRank(25, [10, 20, 30, 40]), 50);
  assert.equal(percentileRank(45, [10, 20, 30, 40]), 100);
  assert.equal(percentileRank(5, [10, 20, 30, 40]), 0);
});

test("percentileRank: returns null when window empty or value non-finite", () => {
  assert.equal(percentileRank(5, []), null);
  assert.equal(percentileRank(Number.NaN, [1, 2, 3]), null);
  assert.equal(percentileRank("x", [1, 2, 3]), null);
});

test("mean and stdDev (population) over a clean window", () => {
  assert.equal(mean([2, 4]), 3);
  assert.equal(mean([]), null);
  assert.ok(Math.abs(stdDev([1, 2, 3, 4, 5]) - Math.SQRT2) < 1e-9); // variance 2 -> sd sqrt(2)
  assert.equal(stdDev([5]), null); // need >= 2 points
});

test("zScore: standardised distance from window mean", () => {
  assert.equal(zScore(5, [1, 2, 3, 4, 5]), 1.41); // (5-3)/sqrt(2)
  assert.equal(zScore(5, [5, 5, 5]), 0); // zero variance -> 0, never divide-by-zero
  assert.equal(zScore(5, [5]), null); // < 2 points
  assert.equal(zScore(Number.NaN, [1, 2, 3]), null);
});

test("stats ignore non-finite entries inside the window", () => {
  assert.equal(percentileRank(30, [10, null, 20, "bad", 30, 40]), 75);
  assert.equal(mean([2, undefined, 4]), 3);
});
