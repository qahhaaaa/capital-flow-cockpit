// Layer 1 — 宏观资金流动性 (macro net liquidity / 放水-收水).
// Free source: FRED public CSV (fredgraph.csv, NO api key). NOTE: the multi-id combined
// endpoint returns a ZIP when series differ in frequency, so each series is fetched
// SEPARATELY (single-series CSV) and merged here by date with forward-fill.
// Net Liquidity = WALCL/1000 - TGA - RRP (consistent billions). The SIGNAL is the trend
// (rising=放水/risk_on, falling=收水/risk_off); macro GATES every position.
import { clamp, round } from "../../math.mjs";
import { percentileRank } from "../stats.mjs";

const EPS_PCT = 0.001; // 0.1% deadband on net-liquidity change before calling a direction

function cell(value) {
  if (value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text === ".") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

// Single-series fredgraph.csv (header: observation_date,<ID>) -> [{date, value}].
export function parseFredSeries(csvText) {
  const lines = String(csvText ?? "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const out = [];
  for (let row = 1; row < lines.length; row += 1) {
    const cols = lines[row].split(",");
    const date = cols[0]?.trim();
    if (!date) continue;
    out.push({ date, value: cell(cols[1]) });
  }
  return out;
}

const toMap = (arr) => new Map((arr ?? []).map((p) => [p.date, p.value]));

// Merge the three series by the union of dates, forward-fill each, compute net liquidity
// once all three are known. Units: WALCL millions -> /1000 to billions; TGA/RRP billions.
export function buildNetLiquiditySeries({ walcl = [], tga = [], rrp = [] } = {}) {
  const mapW = toMap(walcl);
  const mapT = toMap(tga);
  const mapR = toMap(rrp);
  const dates = [...new Set([...mapW.keys(), ...mapT.keys(), ...mapR.keys()])].sort();

  let w = null;
  let t = null;
  let r = null;
  const series = [];
  for (const date of dates) {
    if (mapW.get(date) !== undefined && mapW.get(date) !== null) w = mapW.get(date);
    if (mapT.get(date) !== undefined && mapT.get(date) !== null) t = mapT.get(date);
    if (mapR.get(date) !== undefined && mapR.get(date) !== null) r = mapR.get(date);
    if (w !== null && t !== null && r !== null) {
      // Units: WALCL & WTREGEN(TGA) are MILLIONS -> /1000 to billions; RRPONTSYD is BILLIONS.
      series.push({ date, walcl: w, tga: t, rrp: r, netLiq: round(w / 1000 - t / 1000 - r, 1) });
    }
  }
  return series;
}

export function computeMacroSignal(series, { lookback = 4 } = {}) {
  const clean = (series ?? []).filter((point) => Number.isFinite(point?.netLiq));
  if (clean.length < 2) {
    return {
      layer: "macro",
      direction: "neutral",
      strength: null,
      confidence: "low",
      components: [],
      rotationEdges: [],
      drivers: ["净流动性数据不足,无法判断放水/收水"],
      dataQuality: clean.length ? "partial" : "missing",
    };
  }

  const values = clean.map((point) => point.netLiq);
  const latest = values.at(-1);
  const prev = values[Math.max(0, values.length - 1 - lookback)];
  const changePct = prev !== 0 ? (latest - prev) / Math.abs(prev) : 0;
  const direction = changePct > EPS_PCT ? "risk_on" : changePct < -EPS_PCT ? "risk_off" : "neutral";

  const absDiffs = values.slice(1).map((value, index) => Math.abs(value - values[index]));
  const strength = percentileRank(Math.abs(latest - prev), absDiffs) ?? clamp(round(Math.abs(changePct) * 1000, 0));

  const last = clean.at(-1);
  const components = [{ metric: "netLiquidityUsdB", value: round(latest, 1), changePct: round(changePct * 100, 2) }];
  if (Number.isFinite(last?.walcl)) components.push({ metric: "walclUsdB", value: round(last.walcl / 1000, 1) });
  if (Number.isFinite(last?.tga)) components.push({ metric: "tgaUsdB", value: round(last.tga / 1000, 1) });
  if (Number.isFinite(last?.rrp)) components.push({ metric: "rrpUsdB", value: round(last.rrp, 1) });

  return {
    layer: "macro",
    direction,
    strength,
    confidence: clean.length >= 8 ? "high" : "medium",
    components,
    rotationEdges: [],
    drivers: [
      direction === "risk_on" ? "净流动性回升(偏放水)" : direction === "risk_off" ? "净流动性收缩(偏收水)" : "净流动性走平",
    ],
    dataQuality: clean.length >= 8 ? "ok" : "partial",
  };
}
