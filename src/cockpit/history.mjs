// Rolling history for the cockpit: stores each collection's per-chain stablecoin
// share so layer signals can compute change / percentile / strength over time.
// Missing shares are stored as null and dropped from series — never coerced to 0.
import { SUPPORTED_CHAINS } from "../config.mjs";

const MAX_POINTS = 180;

export function buildHistoryEntry({ ts, perChain }) {
  const chainShares = {};
  for (const component of perChain ?? []) {
    chainShares[component.chain] = component.share ?? null;
  }
  return { ts, chainShares };
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
