// L1 provider — FRED public single-series CSV (no API key). Each series fetched
// SEPARATELY (the multi-id endpoint returns a ZIP for mixed frequencies), then merged.
import { buildNetLiquiditySeries, parseFredSeries } from "../layers/macro.mjs";

export const FRED_SERIES = ["WALCL", "WTREGEN", "RRPONTSYD"];
export const fredCsvUrl = (id) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;

export async function loadFredNetLiquiditySnapshot({ fetchImpl = fetch } = {}) {
  const fetchSeries = async (id) => {
    const response = await fetchImpl(fredCsvUrl(id));
    if (!response.ok) throw new Error(`FRED ${id} HTTP ${response.status}`);
    return parseFredSeries(await response.text());
  };

  const [walcl, tga, rrp] = await Promise.all([
    fetchSeries("WALCL"),
    fetchSeries("WTREGEN"),
    fetchSeries("RRPONTSYD"),
  ]);
  const series = buildNetLiquiditySeries({ walcl, tga, rrp });
  return { source: "fred-net-liquidity", series, latest: series.at(-1) ?? null };
}
