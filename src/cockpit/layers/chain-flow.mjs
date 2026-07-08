// Layer 2 — 链间资金流动 (chain capital flow).
// Free, verified source: stablecoins.llama.fi/stablecoinchains (per-chain stablecoin
// circulating supply). A chain's *share* of global stablecoin supply, and how that
// share is changing, is a cleaner free proxy for inter-chain capital migration than
// the (paid/anti-scraped) bridge endpoints. See docs/capital-flow-rotation-survey-2026-06-19.md.
import { SUPPORTED_CHAINS } from "../../config.mjs";
import { round, clamp } from "../../math.mjs";
import { cleanWindow, cusum, emaGap, percentileRank, resampleByTime } from "../stats.mjs";

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

const FEE_SPIKE_SHARE = 60; // 单一协议占该链 fee > 60% = 集中/尖刺(如出块/MEV builder),非广义链活动

function feeMomentumForChain(entry) {
  const apps = Array.isArray(entry?.topApps) ? entry.topApps : [];
  let weighted = 0;
  let weightSum = 0;
  let maxShare = 0;
  let dominant = null;
  for (const app of apps) {
    const momentum = finite(app?.momentum);
    const share = finite(app?.share);
    if (momentum === null || share === null) continue;
    weighted += momentum * share;
    weightSum += share;
    if (share > maxShare) { maxShare = share; dominant = app; }
  }
  if (weightSum <= 0) return { momentum: null, spikeShare: null, dominant: null };
  return {
    momentum: round(weighted / weightSum, 3),
    spikeShare: maxShare >= FEE_SPIKE_SHARE ? round(maxShare, 0) : null,
    dominant: maxShare >= FEE_SPIKE_SHARE ? (dominant?.protocol ?? null) : null,
  };
}

// ── Multi-horizon composite direction ────────────────────────────────────────
// Rotation is a FLOW/activity event; stablecoin *supply* share (存量) barely moves
// intraday, so it must NOT dominate (the old 0.5 share weight is exactly why the
// SOL→BSC rotation of 2026-07-05 — obvious in DEX volume/fees — was never drawn).
// Blend three horizons — fast(6h) / mid(24h) / slow(存量) — at 0.45 / 0.35 / 0.20,
// renormalising over whatever is present (fast absent until the GT aggregate lands).
const HORIZON_WEIGHTS = { fast: 0.45, mid: 0.35, slow: 0.2 };
const COMPOSITE_FLAT = 0.05;
const ACCEL_DEADBAND = 0.1; // 6h vs 24h-avg volume acceleration deadband (±10%)

// Weighted mean over non-null scores, weights renormalised; null when none present.
function blend(parts) {
  const live = parts.filter((p) => p.score !== null && Number.isFinite(p.score));
  if (live.length === 0) return null;
  const wSum = live.reduce((sum, p) => sum + p.weight, 0);
  return live.reduce((sum, p) => sum + p.score * (p.weight / wSum), 0);
}

function activityMap(chainActivity) {
  return chainActivity && typeof chainActivity === "object" ? new Map(Object.entries(chainActivity)) : new Map();
}

// Fast horizon: GeckoTerminal 6h volume acceleration (main) + price momentum + buy imbalance.
function fastScore(activity) {
  const accel6h = finite(activity?.accel6h);
  const accel1h = finite(activity?.accel1h);
  const pxMom6h = finite(activity?.pxMom6h);
  const buyImb6h = finite(activity?.buyImb6h);
  const accelScore = accel6h === null ? null
    : scoreFromDirection(signDirection(accel6h, { deadband: ACCEL_DEADBAND }), Math.min(Math.abs(accel6h), 1));
  const pxScore = pxMom6h === null ? null : clamp(pxMom6h / 20, -1, 1);
  const imbScore = buyImb6h === null ? null : clamp(buyImb6h, -1, 1);
  const score = blend([
    { weight: 0.6, score: accelScore },
    { weight: 0.25, score: pxScore },
    { weight: 0.15, score: imbScore },
  ]);
  return { score, accel6h, accel1h, pxMom6h };
}

// Mid horizon: DeFiLlama 24h DEX volume change + protocol-fee momentum.
function midScore(dexRow, feesEntry) {
  const dexVolChange1dPct = finite(dexRow?.dexVolChange1dPct);
  const dexScore = dexVolChange1dPct === null ? null
    : scoreFromDirection(signDirection(dexVolChange1dPct, { deadband: DEX_MOMENTUM_DEADBAND_PCT }), Math.min(Math.abs(dexVolChange1dPct) / 100, 1));
  const fee = feeMomentumForChain(feesEntry);
  let feeScore = fee.momentum === null ? null
    : scoreFromDirection(signDirection(fee.momentum, { deadband: FEE_MOMENTUM_EPS }), Math.min(Math.abs(fee.momentum), 1));
  // 单一协议主导 fee(如以太坊 Titan Builder 出块/MEV)→ 按集中度线性折价:60%→不折,100%→归零。
  // 一个 builder 的手续费暴涨不是"热钱轮入这条链",不该把链抬成头号目的地。
  let feeSpike = null;
  if (fee.spikeShare !== null && feeScore !== null) {
    const factor = clamp((100 - fee.spikeShare) / 40, 0, 1);
    feeScore = round(feeScore * factor, 4);
    feeSpike = { protocol: fee.dominant, share: fee.spikeShare, discount: round(1 - factor, 2) };
  }
  const score = blend([{ weight: 0.6, score: dexScore }, { weight: 0.4, score: feeScore }]);
  return { score, dexScore, feeScore, dexVolChange1dPct, feesMomentum: fee.momentum, feeSpike };
}

function applyComposite(component, { dexVolumeByChain, feesByChain, activityByChain }) {
  const fast = fastScore(activityByChain.get(component.chain));
  const dexRow = dexVolumeByChain.get(component.chain);
  const mid = midScore(dexRow, feesByChain.get(component.chain));
  const slow = Number.isFinite(component.shareDeltaPp)
    ? scoreFromDirection(component.direction, (component.strength ?? 0) / 100)
    : null;
  const composite = blend([
    { weight: HORIZON_WEIGHTS.fast, score: fast.score },
    { weight: HORIZON_WEIGHTS.mid, score: mid.score },
    { weight: HORIZON_WEIGHTS.slow, score: slow },
  ]);
  const enriched = {
    ...component,
    dexVolChange1dPct: mid.dexVolChange1dPct,
    dexVol24hUsd: finite(dexRow?.dexVol24hUsd), // 24h 绝对成交额(展示用)
    dexVolChange7dPct: finite(dexRow?.dexVolChange7dPct), // 7d 变化(展示用;广度另在 collect 取)
    feesMomentum: mid.feesMomentum,
    feeSpike: mid.feeSpike,
    accel6h: fast.accel6h,
    accel1h: fast.accel1h,
    pxMom6h: fast.pxMom6h,
    fastScore: fast.score === null ? null : round(fast.score, 4),
    midScore: mid.score === null ? null : round(mid.score, 4),
    slowScore: slow === null ? null : round(slow, 4),
    compositeScore: composite === null ? null : round(composite, 4),
  };
  if (composite === null) return enriched;
  const direction = composite > COMPOSITE_FLAT ? "inflow" : composite < -COMPOSITE_FLAT ? "outflow" : "flat";
  // 入向驱动分类:只要交易面(6h快 + 24hDEX)有实质正贡献就算「交易热钱」;交易冷/负、纯靠
  // 费用才撑起入向 → 「费用驱动」(ETH 那种 DEX 在降、只靠出块费用的假象)。
  const posTrading = Math.max(0, fast.score ?? 0) + Math.max(0, mid.dexScore ?? 0);
  const posFee = Math.max(0, mid.feeScore ?? 0);
  const flowType = direction !== "inflow" ? null : posTrading > 0.05 ? "trading" : posFee > 0 ? "fee" : "trading";
  return {
    ...enriched,
    direction,
    strength: clamp(round(Math.abs(composite) * 100, 0)),
    flowType,
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

// Edge thresholds (composite score, −1..1). Asymmetric on purpose: the DESTINATION must
// be a clear inflow, but a net-negative SOURCE is enough — a strong "money is going HERE"
// with a mild "leaving THERE" is a real rotation (SOL was only mildly negative, BSC strong).
// 目的地阈值 0.10(费用驱动的边已被过滤掉,交易型目的地在 0.10+ 即为真实轮入,不必再抬到 0.15)。
const EDGE_IN_MIN = 0.1;
const EDGE_OUT_MAX = -0.05;

// Rotation from the COMPOSITE signal (fast+mid+slow), not raw stablecoin share. Two-tier
// stage: `confirmed` when the 24h(mid) horizon agrees at both ends; `early` when only the
// fast horizon drives it (heads-up, not yet confirmed). slowFollow = stablecoin supply has
// begun to follow (the durable tell).
function compositeRotationEdges(components) {
  const scored = components.filter((c) => Number.isFinite(c.compositeScore));
  if (scored.length < 2) return { edges: [], inflow: null, outflow: null };
  const outflow = [...scored].sort((a, b) => a.compositeScore - b.compositeScore)[0]; // weakest = 来源
  if (outflow.compositeScore >= EDGE_OUT_MAX) return { edges: [], inflow: null, outflow: null };
  // ALL trading-driven inflow destinations. Fee-driven inflows (flowType "fee" — e.g. ETH lifted
  // by a block-builder's fees while its trading falls) are FILTERED OUT of the rotation map: they
  // are not real hot-money rotation. They stay visible in the L2 chain table (with the fee-spike
  // flag) for cross-reference, just not drawn as a rotation edge.
  const dests = scored
    .filter((c) => c.chain !== outflow.chain && c.compositeScore > EDGE_IN_MIN && c.flowType !== "fee")
    .sort((a, b) => b.compositeScore - a.compositeScore);
  const edges = dests.map((dst) => ({
    from: outflow.chain,
    to: dst.chain,
    type: "chain",
    strength: clamp(round((dst.compositeScore - outflow.compositeScore) * 50, 0)),
    confidence: edgeConfidence(dst, outflow),
    stage: (dst.midScore ?? 0) > 0 && (outflow.midScore ?? 0) < 0 ? "confirmed" : "early",
    slowFollow: (dst.slowScore ?? 0) > 0 && (outflow.slowScore ?? 0) < 0,
    flowType: dst.flowType ?? null, // "trading" 交易热钱 | "fee" 费用驱动
    feeSpike: dst.feeSpike ?? null,
  }));
  return { edges, inflow: dests[0] ?? null, outflow };
}

// Legacy rotation on raw stablecoin share deltas — kept for the non-enhanced call path
// (tests/callers with no volume/fee/activity inputs), byte-compatible with the old logic.
function legacyRotationEdges(baseComponents) {
  const movers = baseComponents.filter((c) => Number.isFinite(c.shareDeltaPp));
  const inflow = [...movers].sort((a, b) => b.shareDeltaPp - a.shareDeltaPp)[0];
  const outflow = [...movers].sort((a, b) => a.shareDeltaPp - b.shareDeltaPp)[0];
  if (!inflow || !outflow || inflow.chain === outflow.chain
    || !(inflow.shareDeltaPp > FLAT_EPS_PP && outflow.shareDeltaPp < -FLAT_EPS_PP)) {
    return { edges: [], inflow: null, outflow: null };
  }
  return {
    edges: [{
      from: outflow.chain,
      to: inflow.chain,
      type: "chain",
      strength: clamp(round((inflow.shareDeltaPp - outflow.shareDeltaPp) * 50, 1)),
      confidence: edgeConfidence(inflow, outflow),
    }],
    inflow,
    outflow,
  };
}

// Per-chain share time-series (chronological, oldest→newest) -> chain-flow LayerSignal.
// Entries may carry `sharePoints` [{ts, share}] (time-anchored path) or a plain numeric
// `shareSeries` (legacy adjacent-diff path). Passing dexVolume/chainFees/chainActivity
// switches on the multi-horizon composite + composite-driven rotation. Pure.
export function computeChainFlowSignal(perChainSeries, { chains = SUPPORTED_CHAINS, dexVolume, chainFees, chainActivity } = {}) {
  const enhanced = dexVolume !== undefined || chainFees !== undefined || chainActivity !== undefined;
  const baseComponents = buildBaseComponents(perChainSeries, chains);
  const components = enhanced
    ? baseComponents.map((component) => applyComposite(component, {
        dexVolumeByChain: byChainMap(dexVolume),
        feesByChain: feesByChainMap(chainFees),
        activityByChain: activityMap(chainActivity),
      }))
    : baseComponents;

  const { edges: rotationEdges, inflow, outflow } = enhanced
    ? compositeRotationEdges(components)
    : legacyRotationEdges(baseComponents);

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
      ? [`${outflow.label} → ${inflow.label} 资金轮动(${rotationEdges[0].stage === "confirmed" ? "已确认" : rotationEdges[0].stage === "early" ? "早期" : "存量迁移"})`]
      : ["四链无显著资金轮动"],
    dataQuality,
  };
}

// ── Persistence signature (P-C) ──────────────────────────────────────────────
// Characterises the CURRENT durability signature of a chain's flow — explicitly NOT a
// forecast: breadth (how many of 1h/6h/24h/7d agree) × streak (consecutive hours held) ×
// momentum (still building vs fading, via CUSUM/EMA on the score history) × slow-money follow
// (stablecoin supply moving too). Needs accumulated hourly history to mature ("积累中" first).
const PERSIST_MIN_POINTS = 6;

export function computeChainPersistence(component, scoreSeries, { dexVolChange7dPct = null } = {}) {
  const composite = finite(component?.compositeScore);
  const dir = composite === null || Math.abs(composite) <= COMPOSITE_FLAT ? 0 : Math.sign(composite);
  const pts = (scoreSeries ?? []).map((p) => finite(p?.score)).filter((s) => s !== null);

  if (dir === 0) {
    return { label: "无显著流向", hours: 0, momentum: "flat", breadth: 0, slowFollow: false, dataQuality: pts.length ? "partial" : "missing" };
  }

  // breadth: how many horizons (1h / 6h / 24h / 7d) point the same way as the composite
  const horizons = [component.accel1h, component.accel6h, component.dexVolChange1dPct, dexVolChange7dPct];
  const breadth = horizons.filter((h) => finite(h) !== null && Math.sign(h) === dir).length;

  // streak: consecutive most-recent hours the composite score held the current sign
  let streak = 0;
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    if (pts[i] !== 0 && Math.sign(pts[i]) === dir) streak += 1;
    else break;
  }

  // momentum: is the flow (measured in its OWN direction) still building or fading?
  const aligned = pts.map((s) => s * dir);
  const drift = cusum(aligned);
  const gap = emaGap(aligned, { fastN: 3, slowN: 8 }).gapPct;
  const momentum = drift.alarm === "up" || (gap ?? 0) > 2 ? "building"
    : drift.alarm === "down" || (gap ?? 0) < -2 ? "fading" : "flat";

  const slowFollow = finite(component.slowScore) !== null && component.slowScore !== 0 && Math.sign(component.slowScore) === dir;

  let label;
  if (pts.length < PERSIST_MIN_POINTS) label = "积累中";
  else if (breadth >= 3 && streak >= PERSIST_MIN_POINTS && slowFollow) label = "结构性(多日)";
  else if (breadth >= 2 && momentum !== "fading") label = "持续(1-3d)"; // 方向中性(流入/流出都用),前端加方向前缀
  else label = "闪现(日内)";

  return { label, hours: streak, momentum, breadth, slowFollow, dataQuality: pts.length >= PERSIST_MIN_POINTS ? "ok" : "partial" };
}