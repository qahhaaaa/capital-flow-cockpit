// dashboard.json v2 ("cockpit/v2") assembler — the single backend↔frontend seam.
// Pure: given the per-layer signals + a watchlist, produce the full snapshot the
// frontend renders (regime, layers, flow state, rotation map, position guidance).
import { computeFlowState, computePositionGuidance } from "./engine.mjs";

const ADVISORY =
  "本面板为资金流向辅助判断,仅供观察与仓位参考,不构成下单指令;真实交易由用户手动执行。";

function buildDataHealth(layerSignals, sourceStatus) {
  const layers = Object.entries(layerSignals).map(([name, signal]) => ({
    layer: name,
    dataQuality: signal?.dataQuality ?? "missing",
    confidence: signal?.confidence ?? "low",
  }));
  return { layers, sourceStatus: sourceStatus ?? [] };
}

export function assembleCockpit({
  layerSignals = {},
  watchlist = [],
  meta = {},
  sourceStatus = [],
  appRevenueHeat = null,
  stableTide = null,
} = {}) {
  const flowState = computeFlowState(layerSignals);
  const guidance = computePositionGuidance(layerSignals, watchlist, { regime: flowState.regime, appRevenueHeat });

  return {
    schema: "cockpit/v2",
    meta: { generatedAt: null, ...meta },
    regime: flowState.regime,
    moneyLocation: flowState.moneyLocation,
    layers: layerSignals,
    flowState,
    guidance,
    // Side-channels: displayed for context, deliberately outside the five-layer engine.
    appRevenueHeat,
    stableTide,
    dataHealth: buildDataHealth(layerSignals, sourceStatus),
    advisory: ADVISORY,
  };
}
