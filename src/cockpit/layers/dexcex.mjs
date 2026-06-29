// Layer 4 — DEX<->CEX 资金流动 (spot vs perp).
// Source: OKX public REST derivatives (funding-rate, open-interest, tickers) for the majors.
// Signal: aggregate funding sign => money toward perps (to_perp, positive funding = longs pay,
// crowded) or spot (to_spot); perp/spot volume ratio as context; crowding from |funding|.
// NOTE: OKX is unreachable on some machines (proxy); failure is isolated to "missing".
// v1 funding threshold is heuristic and should be calibrated to rolling percentiles later.
import { clamp, round } from "../../math.mjs";

const FUNDING_HOT = 0.0005; // |funding| at/above this (per interval) = crowded (heuristic, v1)

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const sum = (arr) => arr.filter(Number.isFinite).reduce((s, x) => s + x, 0);
const mean = (arr) => {
  const clean = arr.filter(Number.isFinite);
  return clean.length ? clean.reduce((s, x) => s + x, 0) / clean.length : null;
};

export function normalizeOkxDerivatives(rawAssets) {
  const assets = (rawAssets ?? []).map((a) => ({
    symbol: a?.symbol ?? null,
    spotVol24hUsd: num(a?.spotVol24hUsd),
    perpVol24hUsd: num(a?.perpVol24hUsd),
    funding: num(a?.funding),
    oiUsd: num(a?.oiUsd),
  }));
  return { assets };
}

export function computeDexCexSignal({ assets } = {}) {
  const list = (assets ?? []).filter(Boolean);
  const spotTotal = sum(list.map((a) => a.spotVol24hUsd));
  const perpTotal = sum(list.map((a) => a.perpVol24hUsd));
  const avgFunding = mean(list.map((a) => a.funding));
  const perpSpotRatio = spotTotal > 0 ? round(perpTotal / spotTotal, 2) : null;

  if (avgFunding === null && perpSpotRatio === null) {
    return {
      layer: "dexCex", direction: "balanced", strength: null, confidence: "low",
      crowding: "unknown", components: [], rotationEdges: [],
      drivers: ["二级衍生品数据不足(OKX 未采集)"], dataQuality: "missing",
    };
  }

  const direction = avgFunding === null ? "balanced" : avgFunding > 0 ? "to_perp" : avgFunding < 0 ? "to_spot" : "balanced";
  const crowding = avgFunding !== null && Math.abs(avgFunding) >= FUNDING_HOT ? "high" : "normal";
  const strength = avgFunding === null ? null : clamp(round((Math.abs(avgFunding) / FUNDING_HOT) * 50, 0));

  return {
    layer: "dexCex",
    direction,
    strength,
    confidence: list.length >= 3 ? "high" : list.length ? "medium" : "low",
    crowding,
    perpSpotRatio,
    components: list.map((a) => ({
      symbol: a.symbol,
      funding: a.funding,
      perpSpot: a.spotVol24hUsd > 0 ? round(a.perpVol24hUsd / a.spotVol24hUsd, 2) : null,
    })),
    rotationEdges: [],
    drivers: [
      direction === "to_perp" ? `资金偏合约${crowding === "high" ? "(拥挤)" : ""}` : direction === "to_spot" ? "资金偏现货" : "现货/合约均衡",
    ],
    dataQuality: list.length ? "ok" : "missing",
  };
}
