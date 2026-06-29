export const SUPPORTED_CHAINS = [
  {
    id: "solana",
    label: "SOL",
    llamaName: "Solana",
    ecosystemSymbols: ["SOL-USDT", "JUP-USDT", "RAY-USDT"],
  },
  {
    id: "base",
    label: "Base",
    llamaName: "Base",
    ecosystemSymbols: ["AERO-USDT", "VIRTUAL-USDT", "ZORA-USDT"],
  },
  {
    id: "ethereum",
    label: "ETH 主网",
    llamaName: "Ethereum",
    ecosystemSymbols: ["ETH-USDT", "UNI-USDT", "LDO-USDT"],
  },
  {
    id: "bsc",
    label: "BSC",
    llamaName: "BSC",
    ecosystemSymbols: ["BNB-USDT", "CAKE-USDT"],
  },
];

// L3 发射台 (launchpad) registry. llamaName must match the protocol name in
// DeFiLlama's free fees overview (api.llama.fi/overview/fees). Matched case-insensitively.
export const LAUNCHPADS = [
  { id: "pumpfun", label: "pump.fun", llamaName: "pump.fun", chain: "solana" },
  { id: "letsbonk", label: "LetsBonk/BONK.fun", llamaName: "BONK.fun Launchpad", chain: "solana" },
  { id: "believe", label: "Believe", llamaName: "Launch Coin on Believe", chain: "solana" },
  { id: "moonshot", label: "Moonshot", llamaName: "moonshot.money", chain: "solana" },
  { id: "fourmeme", label: "four.meme", llamaName: "four.meme", chain: "bsc" },
];

export const FREE_SOURCES = [
  {
    id: "defillama",
    label: "DeFiLlama Free",
    paid: false,
    use: "TVL, DEX volume, stablecoin supply and stablecoin bridge/mint proxy",
  },
  {
    id: "okx-public",
    label: "OKX Public REST",
    paid: false,
    use: "spot and swap ticker proxy",
  },
  {
    id: "gmgn",
    label: "GMGN CLI",
    paid: false,
    use: "24h trending hot-token volume, ATH market cap, liquidity and smart/KOL counts as auxiliary signal",
  },
  {
    id: "dune-public",
    label: "Dune API / Public Dashboards",
    paid: false,
    use: "optional launchpad query results with DUNE_API_KEY and dashboard iframes as manual auxiliary context",
  },
];

export const DEPLOYMENT = {
  defaultMode: "local",
  storage: "static-json",
  alternatives: ["vercel-static", "vps-cron"],
};

export const REFRESH = {
  intervalHours: 4,
  clientPollMs: 4 * 60 * 60 * 1000,
};
