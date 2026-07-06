// Rolling history for the cockpit: stores each collection's per-chain stablecoin
// share AND the global stablecoin total so layer signals can compute change /
// percentile / strength over time. Missing values are stored as null and dropped
// from series — never coerced to 0.
import { SUPPORTED_CHAINS } from "../config.mjs";

// 720 points ≈ 30 days at the 1h collection cadence (was 180 ≈ 30 days at 4h).
const MAX_POINTS = 720;

export function buildHistoryEntry({ ts, perChain, totalUsd }) {
  const chainShares = {};
  for (const component of perChain ?? []) {
    chainShares[component.chain] = component.share ?? null;
  }
  // Strict typeof, no Number() coercion: Number(null) === 0 would PERSIST a fake 0 into the
  // history file whenever the provider degrades to totalUsd: null.
  const total = typeof totalUsd === "number" && Number.isFinite(totalUsd) ? totalUsd : null;
  return { ts, chainShares, totalUsd: total };
}

export function appendCockpitHistory(history, entry, { max = MAX_POINTS } = {}) {
  const list = Array.isArray(history) ? history.slice() : [];
  list.push(entry);
  return list.slice(-max);
}

export function buildShareSeries(history, chains = SUPPORTED_CHAINS) {
  const points = (history ?? []).filter((point) => point && point.chainShares);
  return chains.map((chain) => ({
    chain: chain.id,
    label: chain.label,
    shareSeries: points
      .map((point) => point.chainShares[chain.id])
      .filter((value) => value !== null && value !== undefined && value !== ""),
  }));
}

// Timestamped variant: keeps {ts, share} pairs so the chain-flow layer can anchor deltas
// by REAL elapsed time instead of point count (collection cadence changed 4h -> 1h; a
// per-adjacent-point delta would silently shrink 4x and drown in the deadband).
export function buildShareSeriesWithTs(history, chains = SUPPORTED_CHAINS) {
  const points = (history ?? []).filter((point) => point && point.chainShares && point.ts);
  return chains.map((chain) => ({
    chain: chain.id,
    label: chain.label,
    sharePoints: points
      .map((point) => ({ ts: point.ts, share: point.chainShares[chain.id] }))
      .filter((point) => point.share !== null && point.share !== undefined && point.share !== ""),
  }));
}

// Per-chain composite-score series for persistence (streak / momentum). Entries written
// before the field existed carry no chainScores -> dropped; the series starts when it does.
export function buildChainScoreSeries(history, chains = SUPPORTED_CHAINS) {
  const points = (history ?? []).filter((point) => point && point.ts && point.chainScores);
  return chains.map((chain) => ({
    chain: chain.id,
    scorePoints: points
      .map((point) => ({ ts: point.ts, score: point.chainScores[chain.id] }))
      .filter((point) => typeof point.score === "number" && Number.isFinite(point.score)),
  }));
}

// Global stablecoin total series for the tide side-channel. Entries written before the
// field existed carry no totalUsd -> dropped (the series honestly starts when the data does).
// Strict typeof check, no Number() coercion: Number(null) === 0 would smuggle a fake 0 in —
// the exact "0 stands in for missing" trap (same guard as stats.mjs cleanWindow).
export function buildTideSeries(history) {
  return (history ?? [])
    .filter((point) => point && point.ts && typeof point.totalUsd === "number" && Number.isFinite(point.totalUsd))
    .map((point) => ({ ts: point.ts, totalUsd: point.totalUsd }));
}
