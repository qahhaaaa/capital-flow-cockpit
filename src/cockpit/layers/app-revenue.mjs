// Auxiliary side-channel — app/protocol revenue heat by chain.
// Protocol revenue is activity heat / confirmation context, not liquidity or net inflow.
import { SUPPORTED_CHAINS } from "../../config.mjs";
import { round } from "../../math.mjs";

const MOMENTUM_EPS = 0.05;
// Same denoising pattern as launchpad.mjs: tiny share momentum is noise.
const MIN_SHARE_PCT = 1;
const TOP_APPS = 5;
const SINGLE_APP_SPIKE_PCT = 60;
export const APP_REVENUE_NOTE = "协议收入=活动热度,非流动性/净流入";

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rawForChain(rawByChain, chain) {
  if (!rawByChain || typeof rawByChain !== "object") return null;
  return rawByChain[chain.id] ?? rawByChain[chain.llamaName] ?? null;
}

function appRevenue(protocol) {
  return {
    protocol: String(protocol?.name ?? "Unknown"),
    revenue24h: finite(protocol?.total24h),
    revenue7d: finite(protocol?.total7d),
  };
}

export function normalizeChainAppFees(rawByChain, { chains = SUPPORTED_CHAINS } = {}) {
  const perChainApps = chains.map((chain) => {
    const raw = rawForChain(rawByChain, chain);
    const protocols = Array.isArray(raw?.protocols) ? raw.protocols : [];
    const apps = protocols
      .map(appRevenue)
      .filter((app) => app.revenue24h !== null)
      .sort((a, b) => b.revenue24h - a.revenue24h);
    const totalRevenue24h = apps.reduce((sum, app) => sum + app.revenue24h, 0);

    if (apps.length === 0) {
      return {
        chain: chain.id,
        label: chain.label,
        llamaName: chain.llamaName,
        totalRevenue24h: null,
        topApps: [],
        dataQuality: "missing",
      };
    }

    return {
      chain: chain.id,
      label: chain.label,
      llamaName: chain.llamaName,
      totalRevenue24h: round(totalRevenue24h, 0),
      topApps: apps.slice(0, TOP_APPS).map((app) => ({
        ...app,
        share: totalRevenue24h > 0 ? round((app.revenue24h / totalRevenue24h) * 100, 1) : null,
      })),
      dataQuality: "ok",
    };
  });

  return { perChainApps };
}

function appMomentum(app) {
  const r24 = finite(app?.revenue24h);
  const r7 = finite(app?.revenue7d);
  const dailyAvg7 = r7 !== null && r7 > 0 ? r7 / 7 : null;
  return r24 !== null && dailyAvg7 ? r24 / dailyAvg7 - 1 : null;
}

function appDirection(momentum, share) {
  if (momentum === null) return "unknown";
  const rawDirection = momentum > MOMENTUM_EPS ? "heating" : momentum < -MOMENTUM_EPS ? "cooling" : "flat";
  return share !== null && share < MIN_SHARE_PCT ? "flat" : rawDirection;
}

export function computeAppRevenueSignal(perChainApps, { chains = SUPPORTED_CHAINS } = {}) {
  const byChain = new Map((perChainApps ?? []).map((entry) => [entry.chain, entry]));

  const chainsOut = chains.map((chain) => {
    const entry = byChain.get(chain.id);
    const topApps = (entry?.topApps ?? []).map((app) => {
      const momentum = appMomentum(app);
      const share = finite(app.share);
      const direction = appDirection(momentum, share);
      return {
        protocol: app.protocol,
        revenue24h: finite(app.revenue24h),
        revenue7d: finite(app.revenue7d),
        share,
        momentum: momentum === null ? null : round(momentum, 3),
        direction,
      };
    });
    const dominantApp = topApps[0]
      ? {
          protocol: topApps[0].protocol,
          revenue24h: topApps[0].revenue24h,
          share: topApps[0].share,
        }
      : null;
    const singleAppSpike = (topApps[0]?.share ?? 0) > SINGLE_APP_SPIKE_PCT;

    return {
      chain: chain.id,
      label: chain.label,
      dataQuality: entry?.dataQuality === "ok" && topApps.length > 0 ? "ok" : "missing",
      totalRevenue24h: finite(entry?.totalRevenue24h),
      topApps,
      chainHeat: topApps.some((app) => app.direction === "heating"),
      dominantApp,
      singleAppSpike,
    };
  });

  const okCount = chainsOut.filter((chain) => chain.dataQuality === "ok").length;
  return {
    layer: "appRevenue",
    dataQuality: okCount === chains.length ? "ok" : okCount > 0 ? "partial" : "missing",
    note: APP_REVENUE_NOTE,
    byChain: chainsOut,
  };
}
