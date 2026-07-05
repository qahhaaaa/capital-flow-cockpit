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
const DEX_MOMENTUM_DEADBAND_PCT = 3;
const FEE_MOMENTUM_EPS = 0.05;

// Delta anchor window. FLAT_EPS_PP was calibrated against one 4h collection step; with the
// cadence now 1h, a per-adjacent-point delta would shrink ~4x and drown in that deadband.
// Anchoring each delta at "share now vs >=4h earlier" keeps the semantics cadence-independent.
const ANCHOR_MS = 4 * 60 * 60 * 1000;
const OK_MIN_DELTAS = 8;
const OK_MIN_SPAN_MS = 24 * 60 * 60 * 1000;
// An inflection alarm is only CURRENT within this many resample steps (6 × 4h = 24h);
// older alarms are history, not "an inflection now" — suppressed instead of latched forever.
const INFLECTION_FRESH_STEPS = 6;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function peggedUsd(row) {
  return finite(row?.totalCirculatingUSD?.peggedUSD);
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

function signDirection(value, { deadband }) {
  if (value === null) return null;
  if (value > deadband) return "inflow";
  if (value < -deadband) return "outflow";
  return "flat";
}

function scoreFromDirection(direction, magnitude) {
  if (direction === null) return null;
  if (direction === "flat" || direction === "unknown") return 0;
  const sign = direction === "inflow" ? 1 : -1;
  return sign * clamp(Math.abs(magnitude), 0, 1);
}

function byChainMap(source) {
  const rows = Array.isArray(source?.perChain) ? source.perChain : Array.isArray(source) ? source : [];
  return new Map(rows.map((row) => [row.chain, row]));
}

function feesByChainMap(chainFees) {
  const rows = Array.isArray(chainFees?.byChain) ? chainFees.byChain : Array.isArray(chainFees) ? chainFees : [];
  return new Map(rows.map((row) => [row.chain, row]));
}

function feeMomentumForChain(entry) {
  const apps = Array.isArray(entry?.topApps) ? entry.topApps : [];
  let weighted = 0;
  let weightSum = 0;
  for (const app of apps) {
    const momentum = finite(app?.momentum);
    const share = finite(app?.share);
    if (momentum === null || share === null) continue;
    weighted += momentum * share;
    weightSum += share;
  }
  return weightSum > 0 ? round(weighted / weightSum, 3) : null;
}

function applyEnhancedDirection(component, { dexVolumeByChain, feesByChain }) {
  const dexRow = dexVolumeByChain.get(component.chain);
  const dexVolChange1dPct = finite(dexRow?.dexVolChange1dPct);
  const dexDirection = signDirection(dexVolChange1dPct, { deadband: DEX_MOMENTUM_DEADBAND_PCT });
  const dexScore = dexVolChange1dPct === null
    ? null
    : scoreFromDirection(dexDirection, Math.min(Math.abs(dexVolChange1dPct) / 100, 1));

  const feesMomentum = feeMomentumForChain(feesByChain.get(component.chain));
  const feeDirection = signDirection(feesMomentum, { deadband: FEE_MOMENTUM_EPS });
  const feeScore = feesMomentum === null ? null : scoreFromDirection(feeDirection, Math.min(Math.abs(feesMomentum), 1));

  const shareScore = Number.isFinite(component.shareDeltaPp)
    ? scoreFromDirection(component.direction, (component.strength ?? 0) / 100)
    : null;
  const parts = [
    { weight: 0.5, score: shareScore },
    { weight: 0.3, score: dexScore },
    { weight: 0.2, score: feeScore },
  ].filter((part) => part.score !== null);

  if (parts.length === 0) return { ...component, dexVolChange1dPct, feesMomentum };

  const weightSum = parts.reduce((sum, part) => sum + part.weight, 0);
  const weightedScore = parts.reduce((sum, part) => sum + part.score * (part.weight / weightSum), 0);
  const direction = weightedScore > 0.01 ? "inflow" : weightedScore < -0.01 ? "outflow" : "flat";

  return {
    ...component,
    direction,
    strength: clamp(round(Math.abs(weightedScore) * 100, 0)),
    dexVolChange1dPct,
    feesMomentum,
  };
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

function buildBaseComponents(perChainSeries, chains) {
  const byChain = new Map((perChainSeries ?? []).map((entry) => [entry.chain, entry]));
  return chains.map((chain) => {
    const entry = byChain.get(chain.id);
    return Array.isArray(entry?.sharePoints)
      ? componentFromSharePoints(chain, entry.sharePoints)
      : componentFromPlainSeries(chain, entry?.shareSeries);
  });
}

function canBuildEnhancedEdge(inflow, outflow) {
  const inDex = signDirection(finite(inflow.dexVolChange1dPct), { deadband: DEX_MOMENTUM_DEADBAND_PCT });
  const outDex = signDirection(finite(outflow.dexVolChange1dPct), { deadband: DEX_MOMENTUM_DEADBAND_PCT });
  return inDex === "inflow" && outDex === "outflow";
}

// Per-chain share time-series (chronological, oldest→newest) -> chain-flow LayerSignal.
// Entries may carry `sharePoints` [{ts, share}] (time-anchored path) or a plain numeric
// `shareSeries` (legacy adjacent-diff path). The series are assembled by the rolling-history
// store; this function is pure.
export function computeChainFlowSignal(perChainSeries, { chains = SUPPORTED_CHAINS, dexVolume, chainFees } = {}) {
  const enhanced = dexVolume !== undefined || chainFees !== undefined;
  const baseComponents = buildBaseComponents(perChainSeries, chains);
  const components = enhanced
    ? baseComponents.map((component) => applyEnhancedDirection(component, {
        dexVolumeByChain: byChainMap(dexVolume),
        feesByChain: feesByChainMap(chainFees),
      }))
    : baseComponents;

  const movers = baseComponents.filter((component) => Number.isFinite(component.shareDeltaPp));
  const inflowBase = [...movers].sort((a, b) => b.shareDeltaPp - a.shareDeltaPp)[0];
  const outflowBase = [...movers].sort((a, b) => a.shareDeltaPp - b.shareDeltaPp)[0];
  const byEnhancedChain = new Map(components.map((component) => [component.chain, component]));
  const inflow = inflowBase ? byEnhancedChain.get(inflowBase.chain) : null;
  const outflow = outflowBase ? byEnhancedChain.get(outflowBase.chain) : null;

  const rotationEdges = [];
  if (
    inflowBase &&
    outflowBase &&
    inflowBase.chain !== outflowBase.chain &&
    inflowBase.shareDeltaPp > FLAT_EPS_PP &&
    outflowBase.shareDeltaPp < -FLAT_EPS_PP &&
    (!enhanced || canBuildEnhancedEdge(inflow, outflow))
  ) {
    const spread = inflowBase.shareDeltaPp - outflowBase.shareDeltaPp;
    rotationEdges.push({
      from: outflowBase.chain,
      to: inflowBase.chain,
      type: "chain",
      strength: clamp(round(spread * 50, 1)),
      confidence: edgeConfidence(inflowBase, outflowBase),
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
      (components.length ? Math.max(...components.map((m) => m.strength ?? 0)) : null),
    confidence,
    components,
    rotationEdges,
    drivers: rotationEdges.length
      ? [`${outflowBase.label} → ${inflowBase.label} 稳定币份额迁移`]
      : ["四链稳定币份额无显著迁移"],
    dataQuality,
  };
}