// Layer 3 — 发射台资金流动 (launchpad capital flow).
// Free source: DeFiLlama fees overview (api.llama.fi/overview/fees, dataType=dailyRevenue).
// "Heating/cooling" = latest 24h revenue vs the trailing 7d daily average — self-contained
// momentum, no local history. Specific absolute $ are time-sensitive, so the SIGNAL is the
// momentum + share; raw $ are context. Also rolls up by chain (ties to L2) and names the leader.
import { LAUNCHPADS } from "../../config.mjs";
import { clamp, round } from "../../math.mjs";

const MOMENTUM_EPS = 0.05;
// A launchpad below this share of total 24h launchpad revenue is too small for its momentum
// to be a meaningful flow signal (e.g. $1 revenue at +133% is noise) -> treated as flat.
const MIN_SHARE_PCT = 1;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeLaunchpadFees(raw, { launchpads = LAUNCHPADS } = {}) {
  const protocols = Array.isArray(raw?.protocols) ? raw.protocols : [];
  const byName = new Map(protocols.map((p) => [String(p?.name ?? "").toLowerCase(), p]));

  const perLaunchpad = launchpads.map((lp) => {
    const protocol = byName.get(lp.llamaName.toLowerCase());
    const revenue24h = protocol ? finite(protocol.total24h) : null;
    return {
      launchpad: lp.id,
      label: lp.label,
      chain: lp.chain,
      revenue24h,
      revenue7d: protocol ? finite(protocol.total7d) : null,
      revenue30d: protocol ? finite(protocol.total30d) : null,
      revenueAllTime: protocol ? finite(protocol.totalAllTime) : null,
      dataQuality: revenue24h === null ? "missing" : "ok",
    };
  });

  return { perLaunchpad };
}

export function computeLaunchpadSignal(perLaunchpad, { launchpads = LAUNCHPADS } = {}) {
  const byId = new Map((perLaunchpad ?? []).map((lp) => [lp.launchpad, lp]));
  const totalRev24h = (perLaunchpad ?? [])
    .map((lp) => finite(lp.revenue24h))
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);

  const components = launchpads.map((lp) => {
    const entry = byId.get(lp.id);
    const r24 = entry ? finite(entry.revenue24h) : null;
    if (!entry || entry.dataQuality === "missing" || r24 === null) {
      return {
        launchpad: lp.id, label: lp.label, chain: lp.chain,
        revenue24h: null, revenue7d: null, revenueAllTime: null,
        share: null, momentum: null, direction: "unknown", strength: null, dataQuality: "missing",
      };
    }
    const r7 = finite(entry.revenue7d);
    const dailyAvg7 = r7 !== null && r7 > 0 ? r7 / 7 : null;
    const momentum = dailyAvg7 ? r24 / dailyAvg7 - 1 : null;
    const share = totalRev24h > 0 ? round((r24 / totalRev24h) * 100, 1) : null;
    const rawDirection =
      momentum === null ? "unknown" : momentum > MOMENTUM_EPS ? "heating" : momentum < -MOMENTUM_EPS ? "cooling" : "flat";
    // ignore momentum from negligible-share launchpads (noise on a near-zero base)
    const direction = share !== null && share < MIN_SHARE_PCT && rawDirection !== "unknown" ? "flat" : rawDirection;
    return {
      launchpad: lp.id,
      label: lp.label,
      chain: lp.chain,
      revenue24h: r24,
      revenue7d: r7,
      revenueAllTime: finite(entry.revenueAllTime),
      share,
      momentum: momentum === null ? null : round(momentum, 3),
      direction,
      strength: direction === "flat" || direction === "unknown" ? null : clamp(round(Math.abs(momentum) * 100, 0)),
      dataQuality: dailyAvg7 ? "ok" : "partial",
    };
  });

  const movers = components.filter((c) => Number.isFinite(c.momentum));
  const hottest = [...movers].sort((a, b) => b.momentum - a.momentum)[0];
  const coldest = [...movers].sort((a, b) => a.momentum - b.momentum)[0];

  const rotationEdges = [];
  if (hottest && coldest && hottest.launchpad !== coldest.launchpad
      && hottest.momentum > MOMENTUM_EPS && coldest.momentum < -MOMENTUM_EPS) {
    rotationEdges.push({
      from: coldest.launchpad,
      to: hottest.launchpad,
      type: "launchpad",
      strength: clamp(round((hottest.momentum - coldest.momentum) * 50, 0)),
      confidence: hottest.dataQuality === "ok" && coldest.dataQuality === "ok" ? "high" : "medium",
    });
  }

  // chain rollup (ties launchpad heat to L2 chain flow) + leader
  const byChainMap = new Map();
  for (const c of components) {
    if (!Number.isFinite(c.revenue24h)) continue;
    const entry = byChainMap.get(c.chain) ?? { chain: c.chain, revenue24h: 0 };
    entry.revenue24h += c.revenue24h;
    byChainMap.set(c.chain, entry);
  }
  const byChain = [...byChainMap.values()]
    .map((e) => ({ ...e, revenue24h: round(e.revenue24h, 0), share: totalRev24h > 0 ? round((e.revenue24h / totalRev24h) * 100, 1) : null }))
    .sort((a, b) => b.revenue24h - a.revenue24h);
  const leader = [...components].filter((c) => Number.isFinite(c.revenue24h)).sort((a, b) => b.revenue24h - a.revenue24h)[0];
  const topLaunchpad = leader ? { launchpad: leader.launchpad, label: leader.label, revenue24h: leader.revenue24h, share: leader.share } : null;

  const anyHeating = components.some((c) => c.direction === "heating");
  const anyCooling = components.some((c) => c.direction === "cooling");
  const okCount = components.filter((c) => c.dataQuality === "ok").length;

  return {
    layer: "launchpad",
    direction: anyHeating ? "heating" : anyCooling ? "cooling" : okCount > 0 ? "flat" : "unknown",
    strength: hottest && Number.isFinite(hottest.strength) ? hottest.strength : null,
    confidence: okCount >= Math.ceil(launchpads.length / 2) ? "high" : okCount > 0 ? "medium" : "low",
    components,
    byChain,
    topLaunchpad,
    totalRevenue24h: round(totalRev24h, 0),
    rotationEdges,
    drivers: hottest && hottest.direction === "heating"
      ? [`${hottest.label} 发射台收入升温`]
      : [`龙头 ${topLaunchpad?.label ?? "—"}(${topLaunchpad?.share ?? "—"}% 份额)`],
    dataQuality: components.every((c) => c.dataQuality === "ok")
      ? "ok"
      : components.some((c) => c.dataQuality !== "missing")
        ? "partial"
        : "missing",
  };
}
