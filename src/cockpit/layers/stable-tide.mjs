// Side-channel — 稳定币总量潮汐 (global stablecoin tide).
// Aggregate stablecoin market cap momentum is the most direct free gauge of money entering /
// leaving crypto AS A WHOLE. L2 chain shares only capture internal rotation (shares sum to
// 100% by construction); the tide captures the pool itself expanding or contracting.
// v1 is a side-channel like appRevenueHeat: displayed on the panel and pushed on direction
// flips, but NOT fed into the five-layer engine / conviction until the series matures
// (history entries only started carrying totalUsd when this landed) — P1 follow-up.
import { round } from "../../math.mjs";
import { cusum, emaGap, resampleByTime } from "../stats.mjs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Detector grid: fixed 4h slots regardless of collection cadence (1h today, was 4h).
const STEP_MS = 4 * HOUR_MS;
// |Δ24h| below this (% of total) = flat noise. Heuristic v1 (~$150M on a ~$300B pool);
// like other thresholds it should move to rolling percentiles once history accumulates.
const FLAT_EPS_PCT = 0.05;

const NOTE = "总量=钱进出 crypto 池子的变化;链间份额=池内轮动。旁路展示,不进五层引擎/conviction(v1)。";

// % change of the latest total vs the LATEST point at least `windowMs` earlier; null when
// the series does not yet reach back that far (honest partial, never extrapolated).
function anchoredPct(pts, windowMs) {
  if (pts.length < 2) return null;
  const last = pts.at(-1);
  const cutoff = last.t - windowMs;
  let anchor = null;
  for (const point of pts) {
    if (point.t <= cutoff) anchor = point;
    else break;
  }
  if (!anchor || anchor.v <= 0) return null;
  return round(((last.v - anchor.v) / anchor.v) * 100, 3);
}

// Timestamped totals [{ts, totalUsd}] -> tide side-channel signal. Pure.
export function computeStableTideSignal(tidePoints) {
  const pts = (tidePoints ?? [])
    .map((point) => ({ t: Date.parse(point.ts), v: Number(point.totalUsd) }))
    .filter((point) => Number.isFinite(point.t) && point.v > 0)
    .sort((a, b) => a.t - b.t);

  const base = {
    sideChannel: "stableTide",
    mcapUsd: pts.length ? round(pts.at(-1).v, 0) : null,
    spanHours: pts.length ? round((pts.at(-1).t - pts[0].t) / HOUR_MS, 1) : 0,
    points: pts.length,
    note: NOTE,
  };

  if (pts.length < 2) {
    return {
      ...base,
      direction: "unknown",
      delta24hPct: null,
      delta7dPct: null,
      emaGapPct: null,
      cusumAlarm: null,
      dataQuality: pts.length === 0 ? "missing" : "partial",
    };
  }

  const delta24hPct = anchoredPct(pts, DAY_MS);
  const delta7dPct = anchoredPct(pts, 7 * DAY_MS);
  const resampled = resampleByTime(tidePoints, { stepMs: STEP_MS, value: (p) => p.totalUsd, ts: (p) => p.ts });
  const gap = emaGap(resampled, { fastN: 6, slowN: 42 }); // ≈24h vs ≈7d on the 4h grid
  const drift = cusum(resampled);

  const direction =
    delta24hPct === null
      ? "unknown"
      : delta24hPct > FLAT_EPS_PCT ? "inflow" : delta24hPct < -FLAT_EPS_PCT ? "outflow" : "flat";

  return {
    ...base,
    direction,
    delta24hPct,
    delta7dPct,
    emaGapPct: gap.gapPct,
    // stale alarms are history, not a current turn: only surface within 6 steps (~24h)
    cusumAlarm: drift.alarm !== null && drift.stepsSinceAlarm <= 6 ? drift.alarm : null,
    // "ok" only once the full detector set is live (24h AND 7d anchors both reachable);
    // a 2-day-old series with null 7d/EMA/CUSUM fields stays an honest partial.
    dataQuality: delta24hPct !== null && delta7dPct !== null && resampled.length >= 8 ? "ok" : "partial",
  };
}
