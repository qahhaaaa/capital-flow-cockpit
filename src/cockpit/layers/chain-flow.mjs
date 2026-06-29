// Layer 2 — 链间资金流动 (chain capital flow).
// Free, verified source: stablecoins.llama.fi/stablecoinchains (per-chain stablecoin
// circulating supply). A chain's *share* of global stablecoin supply, and how that
// share is changing, is a cleaner free proxy for inter-chain capital migration than
// the (paid/anti-scraped) bridge endpoints. See docs/capital-flow-rotation-survey-2026-06-19.md.
import { SUPPORTED_CHAINS } from "../../config.mjs";
import { round, clamp } from "../../math.mjs";
import { cleanWindow, percentileRank } from "../stats.mjs";

// Deadband (percentage points of global share) below which a move is "flat" noise.
const FLAT_EPS_PP = 0.02;

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

function edgeConfidence(inflow, outflow) {
  return inflow.dataQuality === "ok" && outflow.dataQuality === "ok" ? "high" : "medium";
}

// Per-chain share time-series (chronological, oldest→newest) -> chain-flow LayerSignal.
// The series are assembled by the rolling-history store; this function is pure.
export function computeChainFlowSignal(perChainSeries, { chains = SUPPORTED_CHAINS } = {}) {
  const byChain = new Map((perChainSeries ?? []).map((entry) => [entry.chain, entry]));

  const components = chains.map((chain) => {
    const entry = byChain.get(chain.id);
    const series = cleanWindow(entry?.shareSeries);
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
