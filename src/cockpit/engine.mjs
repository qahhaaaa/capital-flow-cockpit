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

const POSITIVE = new Set(["risk_on", "inflow", "heating", "rotate_in", "to_spot"]);
const NEGATIVE = new Set(["risk_off", "outflow", "cooling", "rotate_out", "to_perp"]);

const confFactor = (confidence) => CONF_FACTOR[confidence] ?? 0.3;

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

function buildRationale(tier, tailwinds, headwinds, riskFlags, regime) {
  const parts = [`仓位档:${TIER_LABEL[tier]}`];
  if (tailwinds.length) parts.push(`顺风:${tailwinds.map((t) => t.layer).join("/")}`);
  if (headwinds.length) parts.push(`逆风:${headwinds.map((h) => h.layer).join("/")}`);
  if (regime === "risk_off") parts.push("宏观收水,整体压制");
  if (riskFlags.length) parts.push(`风险:${riskFlags.length} 项`);
  return parts.join(" · ");
}

function buildGuidanceRow(target, layerSignals, regime) {
  const tailwindLayers = [];
  const headwindLayers = [];
  const riskFlags = [];
  const ridden = [];
  let rawT = 0;
  let rawH = 0;
  let launchpadTailwind = false;

  const add = (bucket, layer, reason, pts) => bucket.push({ layer, reason, pts: round(pts, 3) });

  // L2 chain
  const chainComp = findComponent(layerSignals.chain, "chain", target.chainTag);
  if (chainComp && chainComp.dataQuality !== "missing") {
    ridden.push(chainComp.dataQuality);
    const pts =
      (WEIGHTS.chain * (Number(chainComp.strength) || 0)) / 100 * confFactor(layerSignals.chain.confidence);
    if (chainComp.direction === "inflow") { rawT += pts; add(tailwindLayers, "chain", `${chainComp.label ?? target.chainTag} 链上资金净流入`, pts); }
    else if (chainComp.direction === "outflow") { rawH += pts; headwindLayers.push({ layer: "chain", reason: `${chainComp.label ?? target.chainTag} 链上资金净流出` }); }
  }

  // L3 launchpad
  const lpComp = findComponent(layerSignals.launchpad, "launchpad", target.launchpadTag);
  if (lpComp && lpComp.dataQuality !== "missing") {
    ridden.push(lpComp.dataQuality);
    const pts =
      (WEIGHTS.launchpad * (Number(lpComp.strength) || 0)) / 100 * confFactor(layerSignals.launchpad.confidence);
    if (lpComp.direction === "heating") {
      rawT += pts;
      add(tailwindLayers, "launchpad", `${lpComp.label ?? target.launchpadTag} 发射台资金升温`, pts);
      if (layerSignals.launchpad.confidence !== "low") launchpadTailwind = true;
    } else if (lpComp.direction === "cooling") {
      rawH += pts;
      headwindLayers.push({ layer: "launchpad", reason: `${lpComp.label ?? target.launchpadTag} 发射台降温` });
    }
  }

  // L5 narrative
  const narrComp = findComponent(layerSignals.narrative, "sector", target.sectorTag);
  if (narrComp && narrComp.dataQuality !== "missing") {
    ridden.push(narrComp.dataQuality);
    const pts =
      (WEIGHTS.narrative * (Number(narrComp.strength) || 0)) / 100 * confFactor(layerSignals.narrative.confidence);
    if (POSITIVE.has(narrComp.direction)) { rawT += pts; add(tailwindLayers, "narrative", `${narrComp.label ?? target.sectorTag} 叙事轮入`, pts); }
    else if (NEGATIVE.has(narrComp.direction)) { rawH += pts; headwindLayers.push({ layer: "narrative", reason: `${narrComp.label ?? target.sectorTag} 叙事轮出` }); }
  }

  // L4 DEX<->CEX (signal-level; direction meaning depends on target type)
  const dx = layerSignals.dexCex;
  if (dx && dx.dataQuality !== "missing") {
    ridden.push(dx.dataQuality);
    const pts = (WEIGHTS.dexCex * (Number(dx.strength) || 0)) / 100 * confFactor(dx.confidence);
    if (target.type === "onchain_spot") {
      if (dx.direction === "to_spot") { rawT += pts; add(tailwindLayers, "dexCex", "资金回流链上现货", pts); }
      else if (dx.direction === "to_perp") { rawH += pts; headwindLayers.push({ layer: "dexCex", reason: "资金偏向 CEX 合约,现货承接弱" }); }
    } else if (target.type === "cex_perp") {
      if (dx.direction === "to_perp") { rawT += pts; add(tailwindLayers, "dexCex", "资金涌向合约", pts); }
      else if (dx.direction === "to_spot") { rawH += pts; headwindLayers.push({ layer: "dexCex", reason: "资金偏现货,合约动能弱" }); }
      if (dx.crowding === "high") riskFlags.push("合约持仓拥挤(funding/OI 偏高),建议降杠杆/防挤");
    }
  }

  const mult = REGIME_MULT[regime] ?? 1;
  const conviction = clamp((rawT - rawH) * 100 * mult, 0, 100);
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
    rationale: buildRationale(tier, tailwindLayers, headwindLayers, riskFlags, regime),
    chainTag: target.chainTag ?? null,
    metrics: target.metrics ?? null,
    dataQuality,
  };
}

export function computePositionGuidance(
  layerSignals = {},
  watchlist = [],
  { regime = mapMacroToRegime(layerSignals.macro) } = {},
) {
  return (watchlist ?? []).map((target) => buildGuidanceRow(target, layerSignals, regime));
}
