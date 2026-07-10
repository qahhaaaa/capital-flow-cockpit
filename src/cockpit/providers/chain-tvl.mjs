// Auxiliary provider — DeFiLlama per-chain TVL (one call for ALL chains, incl. new ones
// like Robinhood Chain that GeckoTerminal doesn't cover). TVL is the 存量流动性 leg of
// "链流动性热度": DEX volume tells how hot the flow is, TVL tells how deep the water is.
import { SUPPORTED_CHAINS } from "../../config.mjs";

export const CHAIN_TVL_URL = "https://api.llama.fi/v2/chains";

function strictNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Raw v2/chains list -> per-configured-chain TVL, matched by llamaName (case-insensitive).
export function normalizeChainTvl(rawList, { chains = SUPPORTED_CHAINS } = {}) {
  const list = Array.isArray(rawList) ? rawList : [];
  const byName = new Map();
  for (const row of list) {
    const tvl = strictNumber(row?.tvl);
    if (tvl === null) continue;
    byName.set(String(row?.name ?? "").toLowerCase(), tvl);
  }
  return chains.map((chain) => {
    const tvl = byName.get(chain.llamaName.toLowerCase());
    const present = typeof tvl === "number" && Number.isFinite(tvl);
    return {
      chain: chain.id,
      tvlUsd: present ? Math.round(tvl) : null,
      dataQuality: present ? "ok" : "missing",
    };
  });
}

export async function loadChainTvlSnapshot({ fetchImpl = fetch, chains = SUPPORTED_CHAINS } = {}) {
  const response = await fetchImpl(CHAIN_TVL_URL);
  if (!response.ok) throw new Error(`chain tvl HTTP ${response.status}`);
  const perChain = normalizeChainTvl(await response.json(), { chains });
  return { source: "defillama-chain-tvl", perChain };
}
