// Cockpit engine — pure cross-layer synthesis.
//  computeFlowState:        five layer signals -> regime + money location + rotation edges + agreement
//  computePositionGuidance: layer signals + watchlist -> per-target conviction & suggested size band
// Advisory only: this NEVER places orders. Tiers/weights are defaults and meant to be tunable.
import { clamp, round } from "../math.mjs";

export const TIER = { FLAT: "flat", PROBE: "probe", SMALL: "small", STANDARD: "standard" };
const TIER_ORDER = [TIER.FLAT, TIER.PROBE, TIER.SMALL, TIER.STANDARD];
const TIER_LABEL = { flat: "空仓", probe: "试探", small: "小仓", standard: "标准" };

// Additive layer weights (sum 1.0). Macro is NOT additive — it gates the whole row.
export const WEIGHTS = { chain: 0.3, launchpad: 0.3, narrative: 0.2, dexCex: 0.2 };
const CONF_FACTOR = { high: 1, medium: 0.6, low: 0.3 };
const REGIME_MULT = { risk_on: 1.1, neutral: 1, unknown: 0.85, risk_off: 0.5 };
const ASSET_FACTOR_WEIGHTS = { momentum: 0.2, flow: 0.1, turnover: 0.1 };

const POSITIVE = new Set(["risk_on", "inflow", "heating", "rotate_in", "to_spot"]);
const NEGATIVE = new Set(["risk_off", "outflow", "cooling", "rotate_out", "to_perp"]);

const confFactor = (confidence) => CONF_FACTOR[confidence] ?? 0.3;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metricNumber(metrics, key) {
  if (!metrics || typeof metrics !== "object" || !hasOwn(metrics, key)) return null;
  return finiteNumber(metrics[key]);
}

function signed(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  const rounded = round(value, digits);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function tierFromConviction(conviction) {
  if (conviction >= 75) return TIER.STANDARD;
  if (conviction >= 50) return TIER.SMALL;
  if (conviction >= 25) return TIER.PROBE;
  return TIER.FLAT;
}
function clampTier(tier, { min, max } = {}) {
  let index = TIER_ORDER.indexOf(tier);
  if (min) index = Math.max(index, TIER_ORDER.indexOf(min));
  if (max) index = Math.min(index, TIER_ORDER.indexOf(max));
  return TIER_ORDER[Math.max(0, index)];
}
const downgradeTier = (tier, steps) =>
  TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - steps)];

export function mapMacroToRegime(macro) {
  if (!macro || macro.dataQuality === "missing") return "unknown";
  if (["risk_on", "risk_off", "neutral"].includes(macro.direction)) return macro.direction;
  return "neutral";
}

const layerPolarity = (signal) =>
  POSITIVE.has(signal?.direction) ? 1 : NEGATIVE.has(signal?.direction) ? -1 : 0;

function describeMoneyLocation(layerSignals, regime) {
  if (layerSignals.dexCex?.direction === "to_perp") return "偏 CEX 合约(投机/杠杆主导)";
  if (layerSignals.dexCex?.direction === "to_spot") return "偏链上现货(承接型资金)";
  if (layerSignals.launchpad?.direction === "heating") return "发射台打新升温";
  if (layerSignals.chain?.direction === "rotating") return "链间轮动中";
  if (regime === "risk_off") return "收水观望";
  return "分散/无明显集中";
}

export function computeFlowState(layerSignals = {}) {
  const layers = Object.values(layerSignals).filter(Boolean);
  const regime = mapMacroToRegime(layerSignals.macro);
  const rotationEdges = layers.flatMap((signal) => signal.rotationEdges ?? []);

  let bullish = 0;
  let bearish = 0;
  for (const signal of layers) {
    const polarity = layerPolarity(signal);
    if (polarity > 0) bullish += 1;
    else if (polarity < 0) bearish += 1;
  }
  const net = bullish > bearish ? "aligned_up" : bearish > bullish ? "aligned_down" : "mixed";

  const highs = layers.filter((signal) => signal.confidence === "high").length;
  const confidence =
    layers.length === 0 ? "low" : highs * 2 >= layers.length ? "high" : highs > 0 ? "medium" : "low";

  return {
    regime,
    moneyLocation: describeMoneyLocation(layerSignals, regime),
    rotationEdges,
    agreement: { bullish, bearish, net },
    confidence,
  };
}

function findComponent(signal, key, tag) {
  if (!signal || !tag) return null;
  return (signal.components ?? []).find((component) => component[key] === tag) ?? null;
}

function weightedLayerPoints(weight, strength, confidence) {
  const cleanStrength = finiteNumber(strength);
  if (cleanStrength === null) return 0;
  return (weight * cleanStrength) / 100 * confFactor(confidence);
}

function buildRationale(tier, tailwinds, headwinds, riskFlags, regime, notes = []) {
  const parts = [`仓位档:${TIER_LABEL[tier]}`];
  if (tailwinds.length) parts.push(`顺风:${tailwinds.map((t) => t.layer).join("/")}`);
  if (headwinds.length) parts.push(`逆风:${headwinds.map((h) => h.layer).join("/")}`);
  if (notes.length) parts.push(notes.join("；"));
  if (regime === "risk_off") parts.push("宏观收水,整体压制");
  if (riskFlags.length) parts.push(`风险:${riskFlags.length} 项`);
  return parts.join(" · ");
}

function computeMomentumFactor(metrics) {
  const terms = [
    ["px24hPct", 0.5, metricNumber(metrics, "px24hPct")],
    ["px6hPct", 0.3, metricNumber(metrics, "px6hPct")],
    ["px1hPct", 0.2, metricNumber(metrics, "px1hPct")],
  ].filter(([, , value]) => value !== null);
  if (!terms.length) return { skipped: "动量字段缺失" };

  const weightSum = terms.reduce((sum, [, weight]) => sum + weight, 0);
  const weighted = terms.reduce((sum, [, weight, value]) => sum + value * (weight / weightSum), 0);
  const score = clamp(Math.tanh(weighted / 20), -1, 1);
  const raw = terms.map(([key, , value]) => `${key}=${signed(value, 2)}%`).join("、");
  return {
    key: "momentum",
    label: "标的动量",
    score,
    detail: `标的动量按可用周期重归一计算，${raw}，合成 ${signed(weighted, 2)}%。`,
  };
}

function computeFlowFactor(metrics) {
  const buys = metricNumber(metrics, "buys24h");
  const sells = metricNumber(metrics, "sells24h");
  if (buys === null || sells === null) return { skipped: "资金流字段缺失" };

  const sample = buys + sells;
  if (sample < 50) return { skipped: "资金流样本不足" };

  const imb = sample === 0 ? 0 : (buys - sells) / sample;
  return {
    key: "flow",
    label: "买卖失衡",
    score: clamp(imb * 2, -1, 1),
    imb,
    sample,
    detail: `24h 买卖笔数 ${round(buys, 0)}/${round(sells, 0)}，失衡度 ${signed(imb, 3)}。`,
  };
}

function computeTurnoverFactor(metrics) {
  const vol24hUsd = metricNumber(metrics, "vol24hUsd");
  const liqUsd = metricNumber(metrics, "liqUsd");
  if (vol24hUsd === null || liqUsd === null) return { skipped: "量价流动性字段缺失" };
  if (liqUsd <= 0 || vol24hUsd < 0) return { skipped: "量价流动性字段无效" };

  const turnover = vol24hUsd / liqUsd;
  const score = turnover <= 0 ? 0 : clamp(Math.log10(turnover), 0, 1);
  return {
    key: "turnover",
    label: "成交/流动性",
    score,
    turnover,
    detail: `24h 成交额 ${round(vol24hUsd, 0)} 美元、流动性 ${round(liqUsd, 0)} 美元，换手 ${round(turnover, 2)}x。`,
  };
}

function computeAssetFactors(metrics) {
  if (!metrics || typeof metrics !== "object") {
    return { points: 0, factors: [], notes: ["标的级数据缺失"] };
  }

  const evaluated = [
    [ASSET_FACTOR_WEIGHTS.momentum, computeMomentumFactor(metrics)],
    [ASSET_FACTOR_WEIGHTS.flow, computeFlowFactor(metrics)],
    [ASSET_FACTOR_WEIGHTS.turnover, computeTurnoverFactor(metrics)],
  ];
  const available = evaluated.filter(([, factor]) => factor.key);
  const skipped = evaluated.map(([, factor]) => factor.skipped).filter(Boolean);
  if (!available.length) return { points: 0, factors: [], notes: ["标的级数据缺失", ...skipped] };

  const weightSum = available.reduce((sum, [weight]) => sum + weight, 0);
  let points = 0;
  const factors = available.map(([weight, factor]) => {
    const pts = factor.score * (weight / weightSum) * 100 * 0.4;
    points += pts;
    return {
      key: factor.key,
      label: factor.label,
      score: round(factor.score, 3),
      pts: round(pts, 1),
      detail: factor.detail,
    };
  });

  return {
    points,
    factors,
    notes: skipped,
  };
}

function chainHeatScore(appRevenueHeat, chainTag) {
  if (!chainTag || !Array.isArray(appRevenueHeat?.byChain)) return null;
  const chain = appRevenueHeat.byChain.find((item) => item?.chain === chainTag);
  if (!chain || chain.dataQuality === "missing") return null;

  let weighted = 0;
  let weightSum = 0;
  for (const app of chain.topApps ?? []) {
    const direction = app?.direction === "heating" ? 1 : app?.direction === "cooling" ? -1 : 0;
    const momentum = finiteNumber(app?.momentum);
    if (!direction || momentum === null) continue;
    const share = finiteNumber(app?.share);
    const revenue = finiteNumber(app?.revenue24h);
    const weight = share !== null && share > 0 ? share : revenue !== null && revenue > 0 ? revenue : 1;
    weighted += direction * clamp(Math.abs(momentum), 0, 1) * weight;
    weightSum += weight;
  }
  if (weightSum <= 0) return null;

  return {
    score: clamp(weighted / weightSum, -1, 1),
    label: chain.label ?? chain.chain ?? chainTag,
  };
}

function buildGuidanceRow(target, layerSignals, regime, appRevenueHeat) {
  const tailwindLayers = [];
  const headwindLayers = [];
  const riskFlags = [];
  const ridden = [];
  let rawT = 0;
  let rawH = 0;
  let launchpadTailwind = false;

  const add = (bucket, layer, reason, pts) => bucket.push({ layer, reason, pts: round(pts, 3) });
  const addHeadwind = (layer, reason, pts) => headwindLayers.push({ layer, reason, pts: round(pts, 3) });

  // L2 chain
  const chainComp = findComponent(layerSignals.chain, "chain", target.chainTag);
  if (chainComp && chainComp.dataQuality !== "missing") {
    ridden.push(chainComp.dataQuality);
    const pts = weightedLayerPoints(WEIGHTS.chain, chainComp.strength, layerSignals.chain.confidence);
    if (chainComp.direction === "inflow") { rawT += pts; add(tailwindLayers, "chain", `${chainComp.label ?? target.chainTag} 链上资金净流入`, pts); }
    else if (chainComp.direction === "outflow") { rawH += pts; addHeadwind("chain", `${chainComp.label ?? target.chainTag} 链上资金净流出`, pts); }
  }

  const heat = chainHeatScore(appRevenueHeat, target.chainTag);
  if (heat && heat.score !== 0) {
    const pts = Math.abs(heat.score) * 0.05;
    if (heat.score > 0) {
      rawT += pts;
      add(tailwindLayers, "链活动热度", `${heat.label} 协议收入动量升温`, pts);
    } else {
      rawH += pts;
      addHeadwind("链活动热度", `${heat.label} 协议收入动量降温`, pts);
    }
  }

  // L3 launchpad
  const lpComp = findComponent(layerSignals.launchpad, "launchpad", target.launchpadTag);
  if (lpComp && lpComp.dataQuality !== "missing") {
    ridden.push(lpComp.dataQuality);
    const pts = weightedLayerPoints(WEIGHTS.launchpad, lpComp.strength, layerSignals.launchpad.confidence);
    if (lpComp.direction === "heating") {
      rawT += pts;
      add(tailwindLayers, "launchpad", `${lpComp.label ?? target.launchpadTag} 发射台资金升温`, pts);
      if (layerSignals.launchpad.confidence !== "low") launchpadTailwind = true;
    } else if (lpComp.direction === "cooling") {
      rawH += pts;
      addHeadwind("launchpad", `${lpComp.label ?? target.launchpadTag} 发射台降温`, pts);
    }
  }

  // L5 narrative
  const narrComp = findComponent(layerSignals.narrative, "sector", target.sectorTag);
  if (narrComp && narrComp.dataQuality !== "missing") {
    ridden.push(narrComp.dataQuality);
    const pts = weightedLayerPoints(WEIGHTS.narrative, narrComp.strength, layerSignals.narrative.confidence);
    if (POSITIVE.has(narrComp.direction)) { rawT += pts; add(tailwindLayers, "narrative", `${narrComp.label ?? target.sectorTag} 叙事轮入`, pts); }
    else if (NEGATIVE.has(narrComp.direction)) { rawH += pts; addHeadwind("narrative", `${narrComp.label ?? target.sectorTag} 叙事轮出`, pts); }
  }

  // L4 DEX<->CEX (signal-level; direction meaning depends on target type)
  const dx = layerSignals.dexCex;
  if (dx && dx.dataQuality !== "missing") {
    ridden.push(dx.dataQuality);
    const pts = weightedLayerPoints(WEIGHTS.dexCex, dx.strength, dx.confidence);
    if (target.type === "onchain_spot") {
      if (dx.direction === "to_spot") { rawT += pts; add(tailwindLayers, "dexCex", "资金回流链上现货", pts); }
      else if (dx.direction === "to_perp") { rawH += pts; addHeadwind("dexCex", "资金偏向 CEX 合约,现货承接弱", pts); }
    } else if (target.type === "cex_perp") {
      if (dx.direction === "to_perp") { rawT += pts; add(tailwindLayers, "dexCex", "资金涌向合约", pts); }
      else if (dx.direction === "to_spot") { rawH += pts; addHeadwind("dexCex", "资金偏现货,合约动能弱", pts); }
      if (dx.crowding === "high") riskFlags.push("合约持仓拥挤(funding/OI 偏高),建议降杠杆/防挤");
    }
  }

  const mult = REGIME_MULT[regime] ?? 1;
  const layerPts = (rawT - rawH) * 100 * mult * 0.6;
  const asset = computeAssetFactors(target.metrics);
  const conviction = clamp(layerPts + asset.points, 0, 100);
  const factors = [
    {
      key: "layers",
      label: "五层信号",
      score: round(layerPts, 1),
      pts: round(layerPts, 1),
      detail: `层信号 rawT=${round(rawT, 3)}、rawH=${round(rawH, 3)}，宏观系数 ${round(mult, 2)}，按 60% 计入。`,
    },
    ...asset.factors,
  ];

  const liqUsd = metricNumber(target.metrics, "liqUsd");
  if (liqUsd !== null && liqUsd < 300_000) riskFlags.push("流动性薄(<$30万)，出场滑点风险");
  const px24hPct = metricNumber(target.metrics, "px24hPct");
  const flowFactor = computeFlowFactor(target.metrics);
  if (flowFactor.key && flowFactor.imb > 0.75 && px24hPct !== null && px24hPct > 50) {
    riskFlags.push("单边追高拥挤");
  }

  let tier = tierFromConviction(conviction);

  // user's flagship rule: heating launchpad in non-risk_off floors the tier at 试探(probe)
  if (launchpadTailwind && regime !== "risk_off") tier = clampTier(tier, { min: TIER.PROBE });

  // on-chain exit-liquidity risk
  if (target.type === "onchain_spot" && target.profile?.exitLiquidity === "low") {
    riskFlags.push("小盘/出场流动性差,控制仓位与滑点余量");
  }
  // each distinct risk flag downgrades one tier
  if (riskFlags.length > 0) tier = downgradeTier(tier, riskFlags.length);
  // risk_off hard cap is always applied last
  if (regime === "risk_off") tier = clampTier(tier, { max: TIER.PROBE });

  const dataQuality =
    ridden.length === 0 ? "missing" : ridden.every((quality) => quality === "ok") ? "ok" : "partial";

  return {
    target: target.target,
    type: target.type,
    conviction: round(conviction, 0),
    tier,
    tierLabel: TIER_LABEL[tier],
    tailwindLayers,
    headwindLayers,
    riskFlags,
    rationale: buildRationale(tier, tailwindLayers, headwindLayers, riskFlags, regime, asset.notes),
    chainTag: target.chainTag ?? null,
    metrics: target.metrics ?? null,
    factors,
    dataQuality,
  };
}

export function computePositionGuidance(
  layerSignals = {},
  watchlist = [],
  { regime = mapMacroToRegime(layerSignals.macro), appRevenueHeat = null } = {},
) {
  return (watchlist ?? []).map((target) => buildGuidanceRow(target, layerSignals, regime, appRevenueHeat));
}