// Dynamic watchlist provider — GeckoTerminal trending pools with CoinGecko fallback.
import { SUPPORTED_CHAINS } from "../../config.mjs";

export const GECKOTERMINAL_NETWORK = {
  solana: "solana",
  ethereum: "eth",
  base: "base",
  bsc: "bsc",
};

const COINGECKO_CATEGORY = {
  solana: "solana-ecosystem",
  ethereum: "ethereum-ecosystem",
  base: "base-ecosystem",
  bsc: "binance-smart-chain",
};

const QUALITY_LIQ_USD = 150_000;
const QUALITY_VOL24_USD = 500_000;
const TOP_PER_CHAIN = 3;

const EXCLUDED_SYMBOLS = new Set([
  "SOL", "WSOL", "ETH", "WETH", "BNB", "WBNB",
  "BTC", "WBTC", "CBBTC", "TBTC",
  "USDC", "USDT", "USD1", "DAI", "BUSD", "FDUSD", "TUSD", "USDD", "USDE", "USDS", "PYUSD", "USDCE", "USDTE",
]);

export function strictNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function symbolFromPoolName(name) {
  return String(name ?? "").split("/")[0]?.trim().toUpperCase() || "";
}

function normalizedSymbol(symbol) {
  return String(symbol ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function isExcludedSymbol(symbol) {
  const normalized = normalizedSymbol(symbol);
  if (!normalized) return true;
  if (EXCLUDED_SYMBOLS.has(normalized)) return true;
  if (/^W?(SOL|ETH|BNB|BTC)$/.test(normalized)) return true;
  return /^USD[A-Z0-9]*$/.test(normalized) || /^[A-Z0-9]*USD[TCDE]?$/.test(normalized);
}

function launchpadTagFromDexId(dexId) {
  const id = String(dexId ?? "").toLowerCase();
  if (id.includes("pump")) return "pumpfun";
  if (id.includes("moonshot")) return "moonshot";
  return null;
}

function geckoUrl(chain) {
  const net = GECKOTERMINAL_NETWORK[chain.id];
  if (!net) throw new Error(`unsupported GeckoTerminal chain ${chain.id}`);
  return `https://api.geckoterminal.com/api/v2/networks/${net}/trending_pools?page=1`;
}

function caFromGeckoBaseToken(row) {
  const id = row?.relationships?.base_token?.data?.id;
  if (typeof id !== "string" || !id) return null;
  const splitAt = id.indexOf("_");
  if (splitAt <= 0 || splitAt >= id.length - 1) return null;
  return id.slice(splitAt + 1) || null;
}

function coingeckoUrl(chain) {
  const category = COINGECKO_CATEGORY[chain.id];
  if (!category) throw new Error(`unsupported CoinGecko category ${chain.id}`);
  const params = new URLSearchParams({
    vs_currency: "usd",
    category,
    order: "volume_desc",
    per_page: "10",
    price_change_percentage: "24h",
  });
  return `https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`;
}

function geckoEntry(row, chain, at) {
  const attributes = row?.attributes ?? {};
  const symbol = symbolFromPoolName(attributes.name);
  const dexId = row?.relationships?.dex?.data?.id ?? null;
  return {
    target: symbol,
    type: "onchain_spot",
    chainTag: chain.id,
    launchpadTag: launchpadTagFromDexId(dexId),
    metrics: {
      priceUsd: strictNumber(attributes.base_token_price_usd),
      px5mPct: strictNumber(attributes.price_change_percentage?.m5),
      px1hPct: strictNumber(attributes.price_change_percentage?.h1),
      px6hPct: strictNumber(attributes.price_change_percentage?.h6),
      px24hPct: strictNumber(attributes.price_change_percentage?.h24),
      vol6hUsd: strictNumber(attributes.volume_usd?.h6),
      vol24hUsd: strictNumber(attributes.volume_usd?.h24),
      liqUsd: strictNumber(attributes.reserve_in_usd),
      buys24h: strictNumber(attributes.transactions?.h24?.buys),
      sells24h: strictNumber(attributes.transactions?.h24?.sells),
      fdvUsd: strictNumber(attributes.fdv_usd),
      marketCapUsd: strictNumber(attributes.market_cap_usd),
      ca: caFromGeckoBaseToken(row),
      source: "geckoterminal",
      at,
    },
  };
}

function coingeckoEntry(row, chain, at) {
  const symbol = String(row?.symbol ?? "").trim().toUpperCase();
  return {
    target: symbol,
    type: "onchain_spot",
    chainTag: chain.id,
    launchpadTag: null,
    metrics: {
      priceUsd: strictNumber(row?.current_price),
      px5mPct: null,
      px1hPct: null,
      px6hPct: null,
      px24hPct: strictNumber(row?.price_change_percentage_24h_in_currency ?? row?.price_change_percentage_24h),
      vol6hUsd: null,
      vol24hUsd: strictNumber(row?.total_volume),
      liqUsd: null,
      buys24h: null,
      sells24h: null,
      fdvUsd: strictNumber(row?.fully_diluted_valuation),
      marketCapUsd: strictNumber(row?.market_cap),
      ca: null,
      source: "coingecko",
      at,
    },
  };
}

function dedupTop(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = normalizedSymbol(entry.target);
    if (!key || isExcludedSymbol(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= TOP_PER_CHAIN) break;
  }
  return out;
}

function parseGecko(raw, chain, at) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  const entries = rows
    .map((row) => geckoEntry(row, chain, at))
    .filter((entry) => entry.metrics.liqUsd !== null && entry.metrics.vol24hUsd !== null)
    .filter((entry) => entry.metrics.liqUsd >= QUALITY_LIQ_USD && entry.metrics.vol24hUsd >= QUALITY_VOL24_USD);
  return dedupTop(entries);
}

function parseCoinGecko(raw, chain, at) {
  const rows = Array.isArray(raw) ? raw : [];
  return dedupTop(rows.map((row) => coingeckoEntry(row, chain, at)));
}

async function getJson(fetchImpl, url, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return response.json();
}

async function loadChainWatchlist(chain, fetchImpl, at) {
  try {
    const raw = await getJson(fetchImpl, geckoUrl(chain), `geckoterminal ${chain.id}`);
    return parseGecko(raw, chain, at);
  } catch (geckoError) {
    try {
      const raw = await getJson(fetchImpl, coingeckoUrl(chain), `coingecko ${chain.id}`);
      return parseCoinGecko(raw, chain, at);
    } catch (fallbackError) {
      throw new Error(`${geckoError.message}; fallback ${fallbackError.message}`);
    }
  }
}

export async function loadDynamicWatchlist({ fetchImpl = fetch, chains = SUPPORTED_CHAINS, now = new Date() } = {}) {
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const perChain = Object.fromEntries(chains.map((chain) => [chain.id, []]));
  const errors = [];

  await Promise.all(chains.map(async (chain) => {
    try {
      perChain[chain.id] = await loadChainWatchlist(chain, fetchImpl, at);
    } catch (error) {
      perChain[chain.id] = [];
      errors.push({ chain: chain.id, message: error.message });
    }
  }));

  return { source: "geckoterminal-trending", perChain, errors };
}