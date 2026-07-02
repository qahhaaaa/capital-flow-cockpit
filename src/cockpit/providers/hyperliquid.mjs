// L4 fallback provider — Hyperliquid public info API (perp funding / OI / 24h notional).
// Why: OKX 451-blocks US IPs, so L4 is permanently missing on GitHub-hosted runners.
// Hyperliquid's API is key-free and not US-blocked, restoring funding/crowding in the cloud.
// Endpoint shape verified live (2026-07-03): POST /info {"type":"metaAndAssetCtxs"} ->
// [meta, assetCtxs] with meta.universe[i].name aligned to assetCtxs[i].
// Caveats (kept honest):
//  - funding is an HOURLY rate -> ×8 to match OKX's 8h-interval convention (FUNDING_HOT
//    in layers/dexcex.mjs is calibrated per 8h interval);
//  - openInterest is in BASE units -> ×markPx for USD;
//  - the endpoint carries NO spot volume -> spotVol24hUsd stays null -> perp/spot ratio
//    null and the layer reports partial rather than a fabricated ratio.
import { normalizeOkxDerivatives } from "../layers/dexcex.mjs";

export const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
export const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "BNB"];

// Strict: null/undefined/"" are MISSING, not 0 — Number(null) === 0 would turn a missing
// funding/volume into a fake zero that dilutes the layer average (same guard as dexcex.mjs).
const num = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function loadHyperliquidDerivativesSnapshot({
  fetchImpl = fetch,
  url = HYPERLIQUID_INFO_URL,
  symbols = DEFAULT_SYMBOLS,
} = {}) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`hyperliquid info HTTP ${response.status}`);
  const payload = await response.json();
  const universe = payload?.[0]?.universe;
  const ctxs = payload?.[1];
  if (!Array.isArray(universe) || !Array.isArray(ctxs)) {
    throw new Error("hyperliquid info: unexpected payload shape");
  }

  const rows = [];
  for (const symbol of symbols) {
    const index = universe.findIndex((asset) => asset?.name === symbol);
    if (index === -1 || !ctxs[index]) continue; // absent asset -> dropped, never zero-filled
    const ctx = ctxs[index];
    const fundingHourly = num(ctx.funding);
    const oiBase = num(ctx.openInterest);
    const markPx = num(ctx.markPx) ?? num(ctx.oraclePx);
    rows.push({
      symbol,
      spotVol24hUsd: null, // endpoint has no spot leg — stays null, ratio stays honest
      perpVol24hUsd: num(ctx.dayNtlVlm),
      funding: fundingHourly === null ? null : fundingHourly * 8, // hourly -> 8h-equivalent
      oiUsd: oiBase !== null && markPx !== null ? oiBase * markPx : null,
    });
  }

  const { assets } = normalizeOkxDerivatives(rows);
  return { source: "hyperliquid-derivatives", assets };
}
