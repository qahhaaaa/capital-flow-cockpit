// Layer 2 — 链间资金流动 (chain capital flow).
// Free, verified source: stablecoins.llama.fi/stablecoinchains (per-chain stablecoin
// circulating supply). A chain's *share* of global stablecoin supply, and how that
// share is changing, is a cleaner free proxy for inter-chain capital migration than
// the (paid/anti-scraped) bridge endpoints. See docs/capital-flow-rotation-survey-2026-06-19.md.
import { SUPPORTED_CHAINS } from "../../config.mjs";
import { round, clamp } from "../../math.mjs";
import { cleanWindow, cusum, percentileRank, resampleByTime } from "../stats.mjs";

// Deadband (percentage points of global share) below which a move is "flat" noise.
const FLAT_EPS_PP = 0.02;

// Delta anchor window. FLAT_EPS_PP was calibrated against one 4h collection step; with the
// cadence now 1h, a per-adjacent-point delta would shrink ~4x and drown in that deadband.
// Anchoring each delta at "share now vs >=4h earlier" keeps the semantics cadence-independent.
const ANCHOR_MS = 4 * 60 * 60 * 1000;
const OK_MIN_DELTAS = 8;
const OK_MIN_SPAN_MS = 24 * 60 * 60 * 1000;
// An inflection alarm is only CURRENT within this many resample steps (6 × 4h = 24h);
// older alarms are history, not "an inflection now" — suppressed instead of latched forever.
const INFLECTION_FRESH_STEPS = 6;

function peggedUsd(row) {
  const value = Number(row?.totalCirculatingUSD?.peggedUSD);
  return Number.isFinite(value) ? value : null;
}

// Raw stablecoinchains feed -> per-configured-chain stablecoin USD + share of global supply.
export function normalizeStablecoinChains(rawList, { chains = SUPPORTED_CHAINS } = {}) {
  const list = Array.isArray(rawList) ? rawList : [];
  const byName = new Map();
  let totalUsd = 0;
  for (const row of list) {
    const usd = peggedUsd(row);
    if (usd === null) continue;
    byName.set(String(row?.name ?? "").toLowerCase(), usd);
    totalUsd += usd;
  }

  const perChain = chains.map((chain) => {
    const usd = byName.get(chain.llamaName.toLowerCase());
    const present = Number.isFinite(usd);
    return {
      chain: chain.id,
      label: chain.label,
      stablecoinUsd: present ? usd : null,
      share: present && totalUsd > 0 ? round((usd / totalUsd) * 100, 4) : null,
      dataQuality: present ? "ok" : "missing",
    };
  });

  return { totalUsd: totalUsd > 0 ? totalUsd : null, perChain };
}

function consecutiveDiffs(series) {
  return series.slice(1).map((value, index) => value - series[index]);
}

// Timestamped share points -> deltas anchored by real elapsed time: for each point, the
// change vs the LATEST point at least ANCHOR_MS earlier. At the old 4h cadence this equals
// the adjacent-point diff (smooth migration); at 1h it spans ~4 points. Exported for the
// detector replay script so analysis runs the exact production math.
export function anchoredDeltas(sharePoints, { anchorMs = ANCHOR_MS } = {}) {
  const pts = (sharePoints ?? [])
    // reject missing BEFORE Number(): Number(null) === 0 would smuggle a fake zero share
    .filter((point) => point && point.share !== null && point.share !== undefined && point.share !== "")
    .map((point) => ({ t: Date.parse(point.ts), share: Number(point.share) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.share))
    .sort((a, b) => a.t - b.t);
  const deltas = [];
  let anchor = 0;
  for (let i = 0; i < pts.length; i += 1) {
    while (anchor + 1 < pts.length && pts[anchor + 1].t <= pts[i].t - anchorMs) anchor += 1;
    if (pts[anchor].t <= pts[i].t - anchorMs) deltas.push(pts[i].share - pts[anchor].share);
  }
  return { pts, deltas };
}

function edgeConfidence(inflow, outflow) {
  return inflow.dataQuality === "ok" && outflow.dataQuality === "ok" ? "high" : "medium";
}

// Component from timestamped points (cadence-independent). `inflection` is a display-only
// CUSUM alarm on the 4h-resampled share series — flags slow persistent drifts whose every
// single step sits inside the deadband; it does NOT alter direction/strength (v1).
function componentFromSharePoints(chain, sharePoints) {
  const { pts, deltas } = anchoredDeltas(sharePoints);
  if (pts.length === 0) {
    return {
      chain: chain.id, label: chain.label, shareNow: null, shareDeltaPp: null,
      direction: "unknown", strength: null, inflection: null, dataQuality: "missing",
    };
  }
  const shareNow = round(pts.at(-1).share, 4);
  if (deltas.length === 0) {
    return {
      chain: chain.id, label: chain.label, shareNow, shareDeltaPp: null,
      direction: "unknown", strength: null, inflection: null, dataQuality: "partial",
    };
  }
  const latestDelta = deltas.at(-1);
  const spanMs = pts.at(-1).t - pts[0].t;
  const resampled = resampleByTime(sharePoints, { stepMs: ANCHOR_MS, value: (p) => p.share, ts: (p) => p.ts });
  const drift = cusum(resampled);
  return {
    chain: chain.id,
    label: chain.label,
    shareNow,
    shareDeltaPp: round(latestDelta, 4),
    direction: latestDelta > FLAT_EPS_PP ? "inflow" : latestDelta < -FLAT_EPS_PP ? "outflow" : "flat",
    strength: percentileRank(Math.abs(latestDelta), deltas.map(Math.abs)),
    inflection: drift.alarm !== null && drift.stepsSinceAlarm <= INFLECTION_FRESH_STEPS ? drift.alarm : null,
    dataQuality: deltas.length >= OK_MIN_DELTAS && spanMs >= OK_MIN_SPAN_MS ? "ok" : "partial",
  };
}

// Legacy component from a plain numeric series (adjacent-point deltas). Kept byte-compatible
// for callers/tests that carry no timestamps; the collector now passes timestamped points.
function componentFromPlainSeries(chain, shareSeries) {
  const series = cleanWindow(shareSeries);
  if (series.length < 2) {
    return {
      chain: chain.id,
      label: chain.label,
      shareNow: series.length ? round(series.at(-1), 4) : null,
      shareDeltaPp: null,
      direction: "unknown",
      strength: null,
      dataQuality: series.length === 0 ? "missing" : "partial",
    };
  }
  const deltas = consecutiveDiffs(series);
  const latestDelta = deltas.at(-1);
  const direction =
    latestDelta > FLAT_EPS_PP ? "inflow" : latestDelta < -FLAT_EPS_PP ? "outflow" : "flat";
  return {
    chain: chain.id,
    label: chain.label,
    shareNow: round(series.at(-1), 4),
    shareDeltaPp: round(latestDelta, 4),
    direction,
    strength: percentileRank(Math.abs(latestDelta), deltas.map(Math.abs)),
    dataQuality: series.length >= 8 ? "ok" : "partial",
  };
}

// Per-chain share time-series (chronological, oldest→newest) -> chain-flow LayerSignal.
// Entries may carry `sharePoints` [{ts, share}] (time-anchored path) or a plain numeric
// `shareSeries` (legacy adjacent-diff path). The series are assembled by the rolling-history
// store; this function is pure.
export function computeChainFlowSignal(perChainSeries, { chains = SUPPORTED_CHAINS } = {}) {
  const byChain = new Map((perChainSeries ?? []).map((entry) => [entry.chain, entry]));

  const components = chains.map((chain) => {
    const entry = byChain.get(chain.id);
    return Array.isArray(entry?.sharePoints)
      ? componentFromSharePoints(chain, entry.sharePoints)
      : componentFromPlainSeries(chain, entry?.shareSeries);
  });

  const movers = components.filter((component) => Number.isFinite(component.shareDeltaPp));
  const inflow = [...movers].sort((a, b) => b.shareDeltaPp - a.shareDeltaPp)[0];
  const outflow = [...movers].sort((a, b) => a.shareDeltaPp - b.shareDeltaPp)[0];

  const rotationEdges = [];
  if (
    inflow &&
    outflow &&
    inflow.chain !== outflow.chain &&
    inflow.shareDeltaPp > FLAT_EPS_PP &&
    outflow.shareDeltaPp < -FLAT_EPS_PP
  ) {
    const spread = inflow.shareDeltaPp - outflow.shareDeltaPp;
    rotationEdges.push({
      from: outflow.chain,
      to: inflow.chain,
      type: "chain",
      strength: clamp(round(spread * 50, 1)),
      confidence: edgeConfidence(inflow, outflow),
    });
  }

  const okCount = components.filter((component) => component.dataQuality === "ok").length;
  const confidence = okCount >= chains.length ? "high" : okCount > 0 ? "medium" : "low";
  const dataQuality = components.every((component) => component.dataQuality === "ok")
    ? "ok"
    : components.some((component) => component.dataQuality !== "missing")
      ? "partial"
      : "missing";

  return {
    layer: "chain",
    direction: rotationEdges.length ? "rotating" : "stable",
    strength:
      rotationEdges[0]?.strength ??
      (movers.length ? Math.max(...movers.map((m) => m.strength ?? 0)) : null),
    confidence,
    components,
    rotationEdges,
    drivers: rotationEdges.length
      ? [`${outflow.label} → ${inflow.label} 稳定币份额迁移`]
      : ["四链稳定币份额无显著迁移"],
    dataQuality,
  };
}
