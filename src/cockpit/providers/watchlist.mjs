// Dynamic watchlist provider — GeckoTerminal trending pools with CoinGecko fallback.
// Also aggregates each chain's SHORT-WINDOW activity (6h/1h) from the SAME response, for the
// fast horizon of the chain-flow composite (earlier rotation detection than DeFiLlama's 24h).
import { SUPPORTED_CHAINS } from "../../config.mjs";
import { round } from "../../math.mjs";

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

// Chain-level short-window activity from ALL returned trending pools (zero extra API calls).
// accel6h = (last-6h hourly rate) / (24h hourly rate) − 1 → is the last 6h running hotter than
// the day average? A genuinely FRESH 6h signal, unlike DeFiLlama's 24h-over-24h change_1d.
// Every field strict-guarded; whole aggregate is null if no volume windows are present.
function aggregateChainActivity(rows, at) {
  let v1 = 0;
  let v6 = 0;
  let v24 = 0;
  let pxw6 = 0;
  let pxwSum6 = 0;
  let buys6 = 0;
  let sells6 = 0;
  let has6 = false;
  let has24 = false;
  for (const row of rows) {
    const a = row?.attributes ?? {};
    const vol1 = strictNumber(a.volume_usd?.h1);
    const vol6 = strictNumber(a.volume_usd?.h6);
    const vol24 = strictNumber(a.volume_usd?.h24);
    if (vol1 !== null) v1 += vol1;
    if (vol6 !== null) { v6 += vol6; has6 = true; }
    if (vol24 !== null) { v24 += vol24; has24 = true; }
    const px6 = strictNumber(a.price_change_percentage?.h6);
    if (px6 !== null && vol6 !== null) { pxw6 += px6 * vol6; pxwSum6 += vol6; }
    const buys = strictNumber(a.transactions?.h6?.buys);
    const sells = strictNumber(a.transactions?.h6?.sells);
    if (buys !== null) buys6 += buys;
    if (sells !== null) sells6 += sells;
  }
  if (!has6 && !has24) return null;
  return {
    vol1h: v1 || null,
    vol6h: v6 || null,
    vol24h: v24 || null,
    accel6h: has6 && has24 && v24 > 0 ? round((v6 / 6) / (v24 / 24) - 1, 4) : null,
    accel1h: has6 && v1 > 0 && v6 > 0 ? round((v1 / 1) / (v6 / 6) - 1, 4) : null,
    pxMom6h: pxwSum6 > 0 ? round(pxw6 / pxwSum6, 3) : null,
    buyImb6h: buys6 + sells6 > 0 ? round((buys6 - sells6) / (buys6 + sells6), 3) : null,
    at,
  };
}

async function getJson(fetchImpl, url, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return response.json();
}

async function loadChainWatchlist(chain, fetchImpl, at) {
  try {
    const raw = await getJson(fetchImpl, geckoUrl(chain), `geckoterminal ${chain.id}`);
    return { entries: parseGecko(raw, chain, at), activity: aggregateChainActivity(Array.isArray(raw?.data) ? raw.data : [], at) };
  } catch (geckoError) {
    try {
      const raw = await getJson(fetchImpl, coingeckoUrl(chain), `coingecko ${chain.id}`);
      return { entries: parseCoinGecko(raw, chain, at), activity: null }; // CoinGecko markets has no short-window pool volume
    } catch (fallbackError) {
      throw new Error(`${geckoError.message}; fallback ${fallbackError.message}`);
    }
  }
}

export async function loadDynamicWatchlist({ fetchImpl = fetch, chains = SUPPORTED_CHAINS, now = new Date() } = {}) {
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const perChain = Object.fromEntries(chains.map((chain) => [chain.id, []]));
  const chainActivity = {};
  const errors = [];

  await Promise.all(chains.map(async (chain) => {
    try {
      const { entries, activity } = await loadChainWatchlist(chain, fetchImpl, at);
      perChain[chain.id] = entries;
      if (activity) chainActivity[chain.id] = activity;
    } catch (error) {
      perChain[chain.id] = [];
      errors.push({ chain: chain.id, message: error.message });
    }
  }));

  return { source: "geckoterminal-trending", perChain, chainActivity, errors };
}