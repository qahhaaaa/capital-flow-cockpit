// Metric envelope: the uniform shape every normalized metric carries into the
// signal engine. Bundles the current value with its rolling-history context
// (percentile / z) and an explicit dataQuality, so downstream signals can express
// strength + confidence and never silently treat missing data as 0.
import { percentileRank, zScore, cleanWindow } from "./stats.mjs";

// Minimum history points for a metric to be considered fully reliable ("ok").
// Below this (but with a finite value) it is "partial"; a non-finite value is "missing".
export const MIN_OK_WINDOW = 8;

export function buildMetricEnvelope({ value, asOf = null, window = [] } = {}) {
  const provided = value !== null && value !== undefined && value !== "";
  const v = provided ? Number(value) : Number.NaN;
  const finite = Number.isFinite(v);
  const cleaned = cleanWindow(window);

  let dataQuality;
  if (!finite) dataQuality = "missing";
  else if (cleaned.length >= MIN_OK_WINDOW) dataQuality = "ok";
  else dataQuality = "partial";

  return {
    value: finite ? v : null,
    asOf,
    window: cleaned,
    percentile: finite ? percentileRank(v, cleaned) : null,
    z: finite ? zScore(v, cleaned) : null,
    dataQuality,
  };
}
