// Layer 2 provider — DeFiLlama stablecoins-by-chain.
// IMPORTANT: use the API endpoint (verified HTTP 200), never scrape the /stablecoins
// frontend (Cloudflare 403). fetch is injectable so the parser is unit-tested offline.
import { normalizeStablecoinChains } from "../layers/chain-flow.mjs";

export const STABLECOINCHAINS_URL = "https://stablecoins.llama.fi/stablecoinchains";

export async function loadStablecoinChainsSnapshot({ fetchImpl = fetch, url = STABLECOINCHAINS_URL } = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`stablecoinchains HTTP ${response.status}`);
  }
  const raw = await response.json();
  const { totalUsd, perChain } = normalizeStablecoinChains(raw);
  return { source: "defillama-stablecoinchains", totalUsd, perChain };
}
