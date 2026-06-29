// Auxiliary provider — DeFiLlama per-chain fees overview for protocol revenue heat.
import { SUPPORTED_CHAINS } from "../../config.mjs";
import { normalizeChainAppFees } from "../layers/app-revenue.mjs";

export const APP_REVENUE_FEES_BASE_URL =
  "https://api.llama.fi/overview/fees";

function appRevenueUrl(chain) {
  const name = encodeURIComponent(chain.llamaName);
  return `${APP_REVENUE_FEES_BASE_URL}/${name}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue`;
}

export async function loadAppRevenueSnapshot({ fetchImpl = fetch, chains = SUPPORTED_CHAINS } = {}) {
  const rawByChain = {};
  const errors = [];

  await Promise.all(chains.map(async (chain) => {
    try {
      const response = await fetchImpl(appRevenueUrl(chain));
      if (!response.ok) {
        throw new Error(`app revenue ${chain.llamaName} HTTP ${response.status}`);
      }
      rawByChain[chain.id] = await response.json();
    } catch (error) {
      rawByChain[chain.id] = null;
      errors.push({ chain: chain.id, message: error.message });
    }
  }));

  const { perChainApps } = normalizeChainAppFees(rawByChain, { chains });
  return { source: "defillama-chain-fees", perChainApps, errors };
}
