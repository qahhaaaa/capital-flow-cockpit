// L4 provider — OKX public REST (spot+perp tickers, funding-rate) for the majors.
// OKX is blocked on direct connection here and reachable only via the local proxy, so this
// uses the proxy-aware getJsonViaProxy (HTTPS_PROXY/HTTP_PROXY/ALL_PROXY). Any failure isolates
// to "missing". getJson is injectable for offline tests.
import { normalizeOkxDerivatives } from "../layers/dexcex.mjs";
import { getJsonViaProxy } from "./http.mjs";

export const OKX_BASE = "https://www.okx.com";
export const DEFAULT_ASSETS = [
  { symbol: "BTC", spot: "BTC-USDT", perp: "BTC-USDT-SWAP" },
  { symbol: "ETH", spot: "ETH-USDT", perp: "ETH-USDT-SWAP" },
  { symbol: "SOL", spot: "SOL-USDT", perp: "SOL-USDT-SWAP" },
  { symbol: "BNB", spot: "BNB-USDT", perp: "BNB-USDT-SWAP" },
];

export async function loadOkxDerivativesSnapshot({ getJson = (url) => getJsonViaProxy(url), assets = DEFAULT_ASSETS } = {}) {
  const okxGet = async (path) => {
    const json = await getJson(`${OKX_BASE}${path}`);
    if (json.code !== "0") throw new Error(`OKX ${path} code ${json.code}`);
    return json.data ?? [];
  };

  const rows = [];
  for (const asset of assets) {
    const [spot] = await okxGet(`/api/v5/market/ticker?instId=${asset.spot}`);
    const [perp] = await okxGet(`/api/v5/market/ticker?instId=${asset.perp}`);
    const [funding] = await okxGet(`/api/v5/public/funding-rate?instId=${asset.perp}`);
    // OKX: spot volCcy24h = quote ccy (USDT≈USD); SWAP volCcy24h = base ccy -> ×last for USD.
    const perpVolBase = Number(perp?.volCcy24h);
    const perpLast = Number(perp?.last);
    rows.push({
      symbol: asset.symbol,
      spotVol24hUsd: Number(spot?.volCcy24h) || null,
      perpVol24hUsd: Number.isFinite(perpVolBase) && Number.isFinite(perpLast) ? perpVolBase * perpLast : null,
      funding: Number(funding?.fundingRate),
      oiUsd: null,
    });
  }
  const { assets: normalized } = normalizeOkxDerivatives(rows);
  return { source: "okx-derivatives", assets: normalized };
}
