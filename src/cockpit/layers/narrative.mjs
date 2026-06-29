// Layer 5 — 主题/叙事轮动 (sector/narrative rotation).
// Free source: DeFiLlama /protocols (api.llama.fi/protocols) aggregated by `category`.
// Combined TVL + TVL-weighted 7d change per category -> cross-sectional relative strength.
// CAVEAT (per research): USD-TVL change mixes in coin price moves; v1 uses it with this caveat,
// BTC/ETH-denominated denoise is a future refinement. AI/meme narratives that aren't DeFi-TVL
// categories need GMGN/mindshare proxies (P1), not this layer.
import { clamp, round } from "../../math.mjs";
import { percentileRank } from "../stats.mjs";

const EPS_PCT = 2; // 7d % deadband
const TOP_N = 8;

export function normalizeCategories(protocols, { topN = TOP_N } = {}) {
  const list = Array.isArray(protocols) ? protocols : [];
  const byCat = new Map();
  for (const p of list) {
    const sector = p?.category;
    const tvl = Number(p?.tvl);
    if (!sector || !Number.isFinite(tvl) || tvl <= 0) continue;
    const cur = byCat.get(sector) ?? { sector, tvl: 0, w7: 0, wTvl7: 0, w1: 0, wTvl1: 0 };
    cur.tvl += tvl;
    const c7 = Number(p?.change_7d);
    if (Number.isFinite(c7)) { cur.w7 += tvl * c7; cur.wTvl7 += tvl; }
    const c1 = Number(p?.change_1d);
    if (Number.isFinite(c1)) { cur.w1 += tvl * c1; cur.wTvl1 += tvl; }
    byCat.set(sector, cur);
  }
  const perSector = [...byCat.values()]
    .map((c) => ({
      sector: c.sector,
      tvl: round(c.tvl, 0),
      change7dPct: c.wTvl7 > 0 ? round(c.w7 / c.wTvl7, 2) : null,
      change1dPct: c.wTvl1 > 0 ? round(c.w1 / c.wTvl1, 2) : null,
    }))
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, topN);
  return { perSector };
}

// CoinGecko /search/trending -> normalized attention proxy (trending searches + categories).
// This is a MINDSHARE PROXY: manipulable (search/engagement gaming), shown for context only.
export function normalizeTrending(raw, { maxCoins = 10, maxCategories = 8 } = {}) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const trendingCoins = (raw?.coins ?? [])
    .map((c) => c?.item)
    .filter(Boolean)
    .slice(0, maxCoins)
    .map((it) => ({
      symbol: String(it.symbol ?? "").toUpperCase(),
      name: it.name ?? null,
      marketCapRank: num(it.market_cap_rank),
      change24hPct: it.data?.price_change_percentage_24h?.usd != null ? Math.round(num(it.data.price_change_percentage_24h.usd)) : null,
    }));
  const trendingCategories = (raw?.categories ?? [])
    .map((c) => ({ name: c?.name ?? null }))
    .filter((c) => c.name)
    .slice(0, maxCategories);
  return { trendingCoins, trendingCategories };
}

export function computeNarrativeSignal(perSector, { mindshare = null } = {}) {
  const sectors = (perSector ?? []).filter((s) => s && s.sector);
  const absChanges = sectors.map((s) => s.change7dPct).filter(Number.isFinite).map(Math.abs);

  const components = sectors.map((s) => {
    const c7 = Number(s.change7dPct);
    if (!Number.isFinite(c7)) {
      return { sector: s.sector, tvl: s.tvl, change7dPct: null, direction: "unknown", strength: null, dataQuality: "missing" };
    }
    return {
      sector: s.sector,
      tvl: s.tvl,
      change7dPct: c7,
      direction: c7 > EPS_PCT ? "rotate_in" : c7 < -EPS_PCT ? "rotate_out" : "flat",
      strength: percentileRank(Math.abs(c7), absChanges),
      dataQuality: "ok",
    };
  });

  const movers = components.filter((c) => Number.isFinite(c.change7dPct));
  const top = [...movers].sort((a, b) => b.change7dPct - a.change7dPct)[0];
  const bottom = [...movers].sort((a, b) => a.change7dPct - b.change7dPct)[0];
  const rotationEdges = [];
  if (top && bottom && top.sector !== bottom.sector && top.change7dPct > EPS_PCT && bottom.change7dPct < -EPS_PCT) {
    rotationEdges.push({
      from: bottom.sector,
      to: top.sector,
      type: "sector",
      strength: clamp(round(top.change7dPct - bottom.change7dPct, 0)),
      confidence: "medium",
    });
  }

  const okCount = components.filter((c) => c.dataQuality === "ok").length;
  return {
    layer: "narrative",
    direction: rotationEdges.length ? "rotating" : okCount ? "flat" : "unknown",
    strength: top && Number.isFinite(top.strength) ? top.strength : null,
    confidence: okCount >= 5 ? "high" : okCount > 0 ? "medium" : "low",
    components,
    rotationEdges,
    drivers: top && top.direction === "rotate_in" ? [`${top.sector} 板块资金轮入`] : ["板块无显著轮动"],
    // attention proxy (manipulable) — informational only, NOT a conviction driver
    mindshare: mindshare && (mindshare.trendingCoins?.length || mindshare.trendingCategories?.length)
      ? { ...mindshare, source: "coingecko-trending", note: "热门搜索/注意力代理,可被刷量操纵,不代表真实资金流" }
      : null,
    dataQuality: okCount === components.length && okCount > 0 ? "ok" : okCount ? "partial" : "missing",
  };
}
