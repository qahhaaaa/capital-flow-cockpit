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

// Resample timestamped points onto a fixed time grid (latest point at or before each grid
// slot; slots before the first point yield nothing). Detector windows (EMA spans, CUSUM
// steps) keep a fixed TIME meaning regardless of collection cadence (4h today, 1h later) —
// point-count windows would silently change meaning when the cadence changes.
export function resampleByTime(points, { stepMs, value = (p) => p.v, ts = (p) => p.ts } = {}) {
  if (!Number.isFinite(stepMs) || stepMs <= 0) return [];
  const parsed = (points ?? [])
    .map((point) => ({ t: Date.parse(ts(point)), v: Number(value(point)) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
    .sort((a, b) => a.t - b.t);
  if (parsed.length === 0) return [];
  const out = [];
  let cursor = 0;
  for (let slot = parsed[0].t; slot <= parsed.at(-1).t; slot += stepMs) {
    while (cursor + 1 < parsed.length && parsed[cursor + 1].t <= slot) cursor += 1;
    out.push(parsed[cursor].v);
  }
  return out;
}

// Dual-window EMA gap: fast EMA vs slow EMA as a % of the slow one. Positive gap = the
// recent window runs above the long window (momentum building) — flags inflections earlier
// than a rolling percentile of one-step deltas. Returns nulls until `slowN` points exist
// (an EMA quoted before its span is filled would overweight the seed value).
export function emaGap(window, { fastN = 6, slowN = 42 } = {}) {
  const clean = cleanWindow(window);
  if (clean.length < slowN || fastN >= slowN) return { fast: null, slow: null, gapPct: null };
  const ema = (n) => {
    const alpha = 2 / (n + 1);
    return clean.reduce((acc, item, index) => (index === 0 ? item : acc + alpha * (item - acc)), 0);
  };
  const fast = ema(fastN);
  const slow = ema(slowN);
  if (!Number.isFinite(fast) || !Number.isFinite(slow) || slow === 0) {
    return { fast: null, slow: null, gapPct: null };
  }
  return { fast: round(fast, 6), slow: round(slow, 6), gapPct: round(((fast - slow) / Math.abs(slow)) * 100, 3) };
}

// Two-sided CUSUM on standardised one-step changes: accumulates drift beyond a `k`-sigma
// allowance and alarms when the cumulative sum crosses `h` sigma. Catches slow persistent
// shifts that per-step deadbands (each step individually "flat") never trip. Needs >= minDiffs
// steps to estimate sigma honestly; degenerate/zero-variance windows return no alarm.
export function cusum(window, { k = 0.5, h = 4, minDiffs = 8 } = {}) {
  const clean = cleanWindow(window);
  const diffs = clean.slice(1).map((item, index) => item - clean[index]);
  if (diffs.length < minDiffs) return { alarm: null, sPos: null, sNeg: null };
  const sigma = stdDev(diffs);
  if (!sigma) return { alarm: null, sPos: 0, sNeg: 0 };
  let sPos = 0;
  let sNeg = 0;
  let alarm = null;
  for (const diff of diffs) {
    const z = diff / sigma;
    sPos = Math.max(0, sPos + z - k);
    sNeg = Math.max(0, sNeg - z - k);
    if (sPos > h) { alarm = "up"; sPos = 0; }
    else if (sNeg > h) { alarm = "down"; sNeg = 0; }
  }
  return { alarm, sPos: round(sPos, 2), sNeg: round(sNeg, 2) };
}
