// Auxiliary provider — GeckoTerminal per-chain TOP pools by 24h volume (page 1 = top 20).
// Purpose: "头部热币"流动性热度画像 —— top 池的量(热钱在打多少)、池液(热钱下面垫着多深的水)、
// 换手 vol/liq(浅水激流 vs 深水慢流)。是 GMGN "每链 top100 币日交易量" 的免费等价替代
// (GMGN 无公开 API 且 Cloudflare 防护,CI 内不可行;GT 免费额度足够,每链 +1 调用/小时)。
// 诚实边界: top20 池 ≈ 头部,不等于全链;无 GT 网络映射的链(如 robinhood)整链 missing。
import { SUPPORTED_CHAINS } from "../../config.mjs";
import { GECKOTERMINAL_NETWORK } from "./watchlist.mjs";

export const CHAIN_POOLS_BASE_URL = "https://api.geckoterminal.com/api/v2/networks";
const TOP_POOL_NAMES = 3;

function strictNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function poolsUrl(chain) {
  const net = GECKOTERMINAL_NETWORK[chain.id];
  if (!net) throw new Error(`unsupported GeckoTerminal chain ${chain.id}`);
  return `${CHAIN_POOLS_BASE_URL}/${net}/pools?sort=h24_volume_usd_desc&page=1`;
}

function missingChain(chain) {
  return {
    chain: chain.id,
    poolCount: null,
    vol24hUsd: null,
    liqUsd: null,
    turnover: null,
    topPools: [],
    dataQuality: "missing",
  };
}

// Raw GT pools response -> per-chain aggregate. Pools missing either volume or reserve are
// skipped (never counted as 0); aggregate is missing when no pool qualifies.
export function aggregateTopPools(raw, chain) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  let vol = 0;
  let liq = 0;
  let count = 0;
  const named = [];
  for (const row of rows) {
    const a = row?.attributes ?? {};
    const v = strictNumber(a.volume_usd?.h24);
    const l = strictNumber(a.reserve_in_usd);
    if (v === null || l === null) continue;
    vol += v;
    liq += l;
    count += 1;
    if (named.length < TOP_POOL_NAMES) {
      named.push({ name: String(a.name ?? "?"), vol24hUsd: Math.round(v), liqUsd: Math.round(l) });
    }
  }
  if (count === 0) return missingChain(chain);
  return {
    chain: chain.id,
    poolCount: count,
    vol24hUsd: Math.round(vol),
    liqUsd: Math.round(liq),
    turnover: liq > 0 ? Number((vol / liq).toFixed(2)) : null,
    topPools: named,
    dataQuality: "ok",
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// SEQUENTIAL with gaps + one 429 retry — NOT Promise.all. GT free tier rate-limits bursts:
// watchlist's trending_pools already fires 4 concurrent GT calls; another concurrent 4 here
// tripped HTTP 429 on 3/4 chains in live testing. Serial spacing keeps us far under the cap.
const REQUEST_GAP_MS = 1200;
const RETRY_429_MS = 5000;

export async function loadChainTopPoolsSnapshot({ fetchImpl = fetch, chains = SUPPORTED_CHAINS, gapMs = REQUEST_GAP_MS } = {}) {
  const perChain = [];
  const errors = [];

  let requested = false;
  for (const chain of chains) {
    let url;
    try {
      url = poolsUrl(chain); // unmapped chain (e.g. robinhood): no request, no gap burned
    } catch (error) {
      perChain.push(missingChain(chain));
      errors.push({ chain: chain.id, message: error.message });
      continue;
    }
    if (requested && gapMs > 0) await sleep(gapMs);
    requested = true;
    try {
      let response = await fetchImpl(url);
      for (const wait of [RETRY_429_MS, RETRY_429_MS * 2]) { // 429 最多重试 2 次(5s/10s)
        if (response.status !== 429) break;
        if (gapMs > 0) await sleep(wait);
        response = await fetchImpl(url);
      }
      if (!response.ok) throw new Error(`top pools ${chain.id} HTTP ${response.status}`);
      perChain.push(aggregateTopPools(await response.json(), chain));
    } catch (error) {
      perChain.push(missingChain(chain));
      errors.push({ chain: chain.id, message: error.message });
    }
  }

  return { source: "geckoterminal-top-pools", perChain, errors };
}
