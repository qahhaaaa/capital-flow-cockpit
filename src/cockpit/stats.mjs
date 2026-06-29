// Rolling distribution helpers for the cockpit signal engine.
// Pure functions: a metric's "strength" and "confidence" are derived from how the
// current value sits inside its own recent history (percentile / z-score), never
// from absolute thresholds (which are time-sensitive and were repeatedly falsified
// in research). See docs/capital-flow-rotation-survey-2026-06-19.md.
import { round } from "../math.mjs";

// Reject genuinely-missing entries (null / undefined / "") BEFORE Number(),
// because Number(null) === 0 and Number("") === 0 would otherwise smuggle a
// fake 0 into the distribution — the exact "0 stands in for missing" trap.
export function cleanWindow(window) {
  return (window ?? [])
    .filter((item) => item !== null && item !== undefined && item !== "")
    .map((item) => Number(item))
    .filter(Number.isFinite);
}

export function mean(window) {
  const clean = cleanWindow(window);
  if (clean.length === 0) return null;
  return clean.reduce((sum, item) => sum + item, 0) / clean.length;
}

export function stdDev(window) {
  const clean = cleanWindow(window);
  if (clean.length < 2) return null;
  const m = clean.reduce((sum, item) => sum + item, 0) / clean.length;
  const variance = clean.reduce((sum, item) => sum + (item - m) ** 2, 0) / clean.length;
  return Math.sqrt(variance);
}

// Percentile rank of `value` within `window`: fraction of window points <= value, 0..100.
// Returns null when there is nothing to rank against or the value is not finite.
export function percentileRank(value, window) {
  const v = Number(value);
  const clean = cleanWindow(window);
  if (!Number.isFinite(v) || clean.length === 0) return null;
  const countLe = clean.filter((item) => item <= v).length;
  return round((countLe / clean.length) * 100, 1);
}

// Standardised distance of `value` from the window mean (population std).
// Returns null with < 2 finite points; returns 0 (not Infinity) on zero variance.
export function zScore(value, window) {
  const v = Number(value);
  const clean = cleanWindow(window);
  if (!Number.isFinite(v) || clean.length < 2) return null;
  const m = clean.reduce((sum, item) => sum + item, 0) / clean.length;
  const sd = stdDev(clean);
  if (sd === 0) return 0;
  return round((v - m) / sd, 2);
}
