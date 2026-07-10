// Auxiliary provider — DeFiLlama per-chain DEX volume overview.
import { SUPPORTED_CHAINS } from "../../config.mjs";

export const DEX_VOLUME_BASE_URL = "https://api.llama.fi/overview/dexs";

function strictNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// totalDataChart(每链每日 DEX 量的完整历史)不再排除 —— 热度卡的 14 天日量柱直接取自
// DeFiLlama 现成历史,零积累等待。breakdown(按协议细分)仍排除,那才是响应大头。
const VOL_SERIES_DAYS = 14;

function chainDexVolumeUrl(chain) {
  const name = encodeURIComponent(chain.llamaName);
  return `${DEX_VOLUME_BASE_URL}/${name}?excludeTotalDataChartBreakdown=true`;
}

function missingChain(chain) {
  return { chain: chain.id, dexVol24hUsd: null, dexVolChange1dPct: null, dexVolChange7dPct: null, volSeries: [] };
}

// Trailing N days of [unixSeconds, dailyVolUsd] -> [{t, v}], strict-guarded (never fake 0s).
export function parseVolSeries(chart, { days = VOL_SERIES_DAYS } = {}) {
  if (!Array.isArray(chart)) return [];
  return chart
    .slice(-days)
    .map((row) => ({ t: strictNumber(row?.[0]), v: strictNumber(row?.[1]) }))
    .filter((point) => point.t !== null && point.v !== null && point.v >= 0);
}

export async function loadChainDexVolumeSnapshot({ fetchImpl = fetch, chains = SUPPORTED_CHAINS } = {}) {
  const perChain = [];
  const errors = [];

  await Promise.all(chains.map(async (chain) => {
    try {
      const response = await fetchImpl(chainDexVolumeUrl(chain));
      if (!response.ok) throw new Error(`dex volume ${chain.llamaName} HTTP ${response.status}`);
      const raw = await response.json();
      perChain.push({
        chain: chain.id,
        dexVol24hUsd: strictNumber(raw?.total24h),
        dexVolChange1dPct: strictNumber(raw?.change_1d),
        dexVolChange7dPct: strictNumber(raw?.change_7d), // 7d horizon for persistence breadth
        volSeries: parseVolSeries(raw?.totalDataChart), // 14d daily bars for the heat card
      });
    } catch (error) {
      perChain.push(missingChain(chain));
      errors.push({ chain: chain.id, message: error.message });
    }
  }));

  const order = new Map(chains.map((chain, index) => [chain.id, index]));
  perChain.sort((a, b) => (order.get(a.chain) ?? 0) - (order.get(b.chain) ?? 0));
  return { source: "defillama-dexs", perChain, errors };
}