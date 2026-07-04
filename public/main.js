import { buildMacroChartModel } from "./macro-context-chart.js";
// Cockpit v2 frontend — renders public/data/cockpit.json. No build step.
// Honest by design: unknown/partial/missing are shown as-is, never hidden or zero-filled.

const REGIME_LABEL = { risk_on: "放水", risk_off: "收水", neutral: "中性", unknown: "未知" };
const DIR_LABEL = {
  inflow: "净流入 ▲", outflow: "净流出 ▼", flat: "持平", unknown: "—",
  rotating: "轮动中", stable: "无显著迁移",
  heating: "升温 ▲", cooling: "降温 ▼",
  to_spot: "偏现货", to_perp: "偏合约", risk_on: "放水", risk_off: "收水", neutral: "中性",
  rotate_in: "轮入 ▲", rotate_out: "轮出 ▼", balanced: "均衡",
};
const dirClass = (d) => (["inflow", "heating", "rotate_in", "to_spot", "risk_on"].includes(d) ? "up"
  : ["outflow", "cooling", "rotate_out", "to_perp", "risk_off"].includes(d) ? "down" : "flat");

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}%`);
const usd = (v) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v); const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const qBadge = (q) => {
  const value = q ?? "missing";
  return `<span class="q q-${esc(value)}">${esc(value)}</span>`;
};

function macroContextPlaceholder() {
  return `<div class="panel macro-context"><h2>宏观背景三曲线图</h2><p class="muted">宏观背景数据加载中...</p></div>`;
}

function macroContextUnavailable(message) {
  return `<div class="panel macro-context"><h2>宏观背景三曲线图</h2><p class="muted">宏观背景数据未配置/加载失败${message ? `:${esc(message)}` : ""}。</p></div>`;
}

async function hydrateMacroContextPanel() {
  const slot = document.getElementById("macro-context-slot");
  if (!slot) return;
  try {
    const res = await fetch("./data/macro-context.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.charts) || data.charts.length === 0) throw new Error("charts empty");
    slot.innerHTML = renderMacroContextPanel(data);
  } catch (error) {
    slot.innerHTML = macroContextUnavailable(error.message);
  }
}

function renderMacroContextPanel(data) {
  const charts = (data.charts ?? []).map(renderMacroContextChart).join("");
  const sourceGroups = (data.charts ?? []).map((chart) => {
    const links = (chart.sources ?? []).map((url, index) => `<a href="${esc(url)}" target="_blank" rel="noreferrer">${index + 1}</a>`).join(" ");
    return `<div><span class="muted">${esc(chart.title ?? chart.id)}</span> ${links || "—"}</div>`;
  }).join("");
  return `<div class="panel macro-context">
    <div class="macro-context-head">
      <h2>宏观背景三曲线图</h2>
      <span class="muted">手工维护·非实时·${esc(data.updatedAt ?? "—")}</span>
    </div>
    <div class="macro-chart-grid">${charts}</div>
    <div class="macro-context-foot">
      <div><strong>数据来源</strong>${sourceGroups}</div>
      <div class="muted">${esc(data.disclaimer ?? "")}</div>
      <div class="muted">标记说明: 空心点=预测; 虚线空心点=口径争议。</div>
    </div>
  </div>`;
}

function renderMacroContextChart(chart) {
  const model = buildMacroChartModel(chart);
  const yTop = formatMacroNumber(model.yMax);
  const yBottom = formatMacroNumber(model.yMin);
  const series = model.series.map((item) => `<path class="macro-line" d="${esc(item.path)}" stroke="${esc(item.color)}"></path>`).join("");
  const points = model.series.flatMap((item) => item.points.map((point) => {
    const classes = ["macro-point", point.estimate ? "estimate" : "", point.disputed ? "disputed" : ""].filter(Boolean).join(" ");
    const fill = point.estimate || point.disputed ? "var(--panel)" : item.color;
    return `<circle class="${classes}" cx="${point.x}" cy="${point.y}" r="3.4" fill="${esc(fill)}" stroke="${esc(item.color)}"><title>${esc(item.label)} ${esc(point.t)}: ${esc(point.v)}</title></circle>`;
  })).join("");
  const xLabels = macroAxisLabels(model.ticks).map((tick) => `<text class="macro-axis" x="${tick.x}" y="${model.height - 8}" text-anchor="middle">${esc(tick.label)}</text>`).join("");
  const legend = model.series.map((item) => `<span><i style="background:${esc(item.color)}"></i>${esc(item.label)}</span>`).join("");
  const flagged = model.series.some((item) => item.points.some((point) => point.estimate || point.disputed));
  const breakdown = chart.id === "hyperscaler-capex" ? renderMacroBreakdown(chart.breakdown2026) : "";

  return `<article class="macro-chart-card">
    <div class="macro-chart-title"><strong>${esc(chart.title ?? chart.id)}</strong><span class="muted">${esc(chart.unit ?? "")}</span></div>
    <svg class="macro-svg" viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="${esc(chart.title ?? chart.id)}">
      <line class="macro-grid-line" x1="${model.margin.left}" x2="${model.width - model.margin.right}" y1="${model.margin.top}" y2="${model.margin.top}"></line>
      <line class="macro-grid-line" x1="${model.margin.left}" x2="${model.width - model.margin.right}" y1="${model.height - model.margin.bottom}" y2="${model.height - model.margin.bottom}"></line>
      <text class="macro-axis" x="4" y="${model.margin.top + 4}">${esc(yTop)}</text>
      <text class="macro-axis" x="4" y="${model.height - model.margin.bottom + 4}">${esc(yBottom)}</text>
      ${xLabels}${series}${points}
    </svg>
    <div class="macro-legend">${legend}</div>
    ${flagged ? `<div class="muted macro-flag-note">预测/口径争议点仅按数据文件标记展示。</div>` : ""}
    ${breakdown}
    <p class="muted macro-note">${esc(chart.note ?? "")}</p>
  </article>`;
}

function renderMacroBreakdown(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const values = items.map((item) => Number(item.v)).filter(Number.isFinite);
  const max = values.length ? Math.max(...values) : 0;
  const rows = items.map((item) => {
    const value = Number(item.v);
    const width = max > 0 && Number.isFinite(value) ? Math.max(2, (value / max) * 100) : 2;
    return `<div class="macro-break-row"><span>${esc(item.name)}</span><div><b style="width:${width}%"></b></div><span class="num">${esc(value)}</span></div>`;
  }).join("");
  return `<div class="macro-breakdown"><div class="muted">2026E 分项</div>${rows}</div>`;
}

function formatMacroNumber(value) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 100) return String(Math.round(value));
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

// X-axis labels: for a dense axis (>8 ticks, e.g. a 16-quarter series), collapse to one label per
// calendar year at that year's first tick (with a min pixel gap) so labels don't overlap. Sparse
// axes keep their per-point labels. Falls back to raw labels when years aren't parseable.
function macroAxisLabels(ticks) {
  if (ticks.length <= 8) return ticks.map((tick) => ({ x: tick.x, label: tick.label }));
  const yearOf = (label) => {
    let m = /^(\d{4})/.exec(label);
    if (m) return Number(m[1]);
    m = /^[1-4]Q(\d{2})/.exec(label);
    if (m) return 2000 + Number(m[1]);
    return null;
  };
  const out = [];
  let lastYear = null;
  let lastX = -Infinity;
  for (const tick of ticks) {
    const year = yearOf(tick.label);
    if (year === null) continue;
    if (year !== lastYear && tick.x - lastX >= 28) {
      out.push({ x: tick.x, label: String(year) });
      lastYear = year;
      lastX = tick.x;
    }
  }
  return out.length ? out : ticks.map((tick) => ({ x: tick.x, label: tick.label }));
}
async function main() {
  const app = document.getElementById("app");
  try {
    const res = await fetch("./data/cockpit.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    app.innerHTML = render(await res.json());
    setupMacroContextLazyHydrate();
  } catch (error) {
    app.innerHTML = `<p class="err">无法加载 ./data/cockpit.json:${esc(error.message)}。请先运行 <code>npm run collect</code>。</p>`;
  }
}

function setupMacroContextLazyHydrate() {
  const details = document.getElementById("macro-context-details");
  if (!details) return;
  let loaded = false;
  details.addEventListener("toggle", () => {
    if (!details.open || loaded) return;
    loaded = true;
    void hydrateMacroContextPanel();
  });
}

function render(d) {
  return [
    conclusionPanel(d),
    trustBar(d),
    guidancePanel(d),
    `<div class="grid two">${launchpadPanel(d)}${chainPanel(d)}</div>`,
    `<div class="grid two">${dexcexPanel(d)}${narrativePanel(d)}</div>`,
    macroPanel(d),
    appRevenuePanel(d),
    rotationPanel(d),
    healthPanel(d),
    macroContextDetails(),
    `<footer><a href="./guide.html">📖 怎么看这张面板</a> · schema ${esc(d.schema)} · 生成于 ${esc(d.meta?.generatedAt ?? "—")} · 历史点 ${esc(d.meta?.historyPoints ?? 0)}</footer>`,
  ].join("");
}

const pctSigned = (v) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`);
const ppSigned = (v, digits = 2) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(digits)}pp`);
const tableScroll = (table) => `<div class="table-scroll">${table}</div>`;
const HOW = {
  macro: "净流动性=美联储资产负债表−TGA−RRP;上行=放水利好风险资产,收水时引擎自动压制所有仓位建议",
  chain: "份额变化(pp)>0=稳定币资金净迁入该链;拐点=每步都小但方向持续的慢漂移警报;ok 需≥24h 积累",
  launchpad: "24h 收入=打新热度的真金白银;动量>0=升温;份额=占五台总收入比;龙头=当前打新主战场",
  dexCex: "funding>0=多头付费=资金挤在合约(过热防挤仓);偏现货=承接型资金更健康;来源 OKX,451 时自动切 Hyperliquid(无现货腿标 partial)",
  narrative: "板块 7d TVL 相对强弱=叙事资金轮动;热门搜索仅是注意力代理,可被操纵,不入引擎",
  tide: "稳定币总市值变化=钱进出 crypto 整个池子;与链间份额(池内轮动)独立",
  appRevenue: "协议收入=活动热度,不是流动性也不是净流入;单协议占比>60% 会标记单点尖刺",
  guidance: "conviction 由各层方向×强度×置信度加权,宏观收水封顶试探;顺风/逆风=支持/反对该标的的层;每条风险降一档",
};

function macroContextDetails() {
  return `<details id="macro-context-details" class="panel macro-context-shell">
    <summary>宏观背景三曲线(手工维护·非实时)· 点击展开</summary>
    <div id="macro-context-slot">${macroContextPlaceholder()}</div>
  </details>`;
}

function layerMissing(layer) {
  return !layer || layer.dataQuality === "missing";
}

function conclusionLine(label, body, cls = "") {
  return `<div class="decision-line ${cls}"><span class="decision-label">${label}</span><div class="decision-body">${body}</div></div>`;
}

function agreementView(net) {
  const map = {
    aligned_up: ["多头共振", "agreement-up"],
    aligned_down: ["空头共振", "agreement-down"],
    mixed: ["分歧", "agreement-mixed"],
  };
  const [label, cls] = map[net] ?? [net ?? "—", "flat"];
  return `<span class="agreement ${cls}">${esc(label)}</span>`;
}

function launchpadHeatLabel(direction) {
  return direction === "heating" ? "升温中" : direction === "cooling" ? "降温中" : direction === "flat" ? "热度持平" : "热度未知";
}

function stableTideLabel(direction, points) {
  const map = { inflow: "新钱进场", outflow: "资金撤出", flat: "总盘持平" };
  return map[direction] ?? `潮汐数据积累中(${esc(points ?? 0)}点)`;
}

function tierSummary(guidance) {
  const order = ["standard", "small", "probe", "flat"];
  const labels = { standard: "标准仓", small: "小仓", probe: "试探", flat: "空仓" };
  return order
    .map((tier) => {
      const count = guidance.filter((g) => g.tier === tier).length;
      return count ? `${count} 个${labels[tier]}` : "";
    })
    .filter(Boolean)
    .join(",");
}

function conclusionPanel(d) {
  return `<section class="panel conclusion-card">
    ${waterLine(d)}
    ${chainConclusionLine(d)}
    ${launchpadConclusionLine(d)}
    ${tideLeverageLine(d)}
    ${actionLine(d)}
    <div class="advisory">${esc(d.advisory ?? "辅助判断,不构成下单指令。")}</div>
  </section>`;
}

function waterLine(d) {
  // regime/moneyLocation/agreement come from flowState (all layers), not macro alone:
  // macro missing -> regime honestly renders "未知", the rest of the line stays informative.
  const r = d.regime ?? "unknown";
  const macroNote = layerMissing(d.layers?.macro) ? ` <span class="muted">(宏观层缺失)</span>` : "";
  return conclusionLine("水位", `<span class="decision-main"><span class="badge b-${esc(r)}">${esc(REGIME_LABEL[r] ?? r)}</span><span>${esc(d.moneyLocation ?? "—")}</span>${agreementView(d.flowState?.agreement?.net)}${macroNote}</span>`);
}

function chainConclusionLine(d) {
  const chain = d.layers?.chain;
  if (layerMissing(chain)) return conclusionLine("链间", `<span class="muted">链间层数据缺失</span>`, "muted");
  const comps = chain.components ?? [];
  const inflow = comps
    .filter((c) => c.direction === "inflow" && Number.isFinite(Number(c.shareDeltaPp)))
    .sort((a, b) => Number(b.shareDeltaPp) - Number(a.shareDeltaPp))[0];
  const allFlat = comps.length > 0 && comps.every((c) => ["flat", "unknown"].includes(c.direction));
  const inflections = comps
    .filter((c) => c.inflection === "up" || c.inflection === "down")
    .map((c) => `${esc(c.label ?? c.chain)}${c.inflection === "up" ? "↑" : "↓"}`);
  // flowState.rotationEdges aggregates ALL layers (launchpad edges included) — the chain
  // line must only show chain-type edges or it contradicts its own "无显著迁移" text.
  const edges = (d.flowState?.rotationEdges ?? chain.rotationEdges ?? []).filter((e) => e?.type === "chain");
  const edge = edges[0];
  const main = inflow
    ? `钱在流入 ${esc(inflow.label ?? inflow.chain)}(<span class="up">${esc(ppSigned(inflow.shareDeltaPp))}</span>)`
    : allFlat ? "链间无显著迁移" : "链间迁移方向不明";
  const edgeText = edge ? ` · <span class="edge">轮动:${esc(edge.from)}→${esc(edge.to)}</span>` : "";
  const warn = inflections.length ? ` · <span class="warn">⚠ 慢漂移拐点:${inflections.join(" ")}</span>` : "";
  return conclusionLine("链间", `${main}${edgeText}${warn}`);
}

function launchpadConclusionLine(d) {
  const lp = d.layers?.launchpad;
  if (layerMissing(lp)) return conclusionLine("发射台", `<span class="muted">发射台数据缺失</span>`, "muted");
  const top = lp.topLaunchpad;
  if (!top) return conclusionLine("发射台", `<span class="muted">发射台数据缺失</span>`, "muted");
  const comp = (lp.components ?? []).find((c) => c.launchpad === top.launchpad || c.label === top.label);
  const direction = comp?.direction ?? lp.direction ?? "unknown";
  return conclusionLine("发射台", `<span class="${dirClass(direction)}">${esc(top.label)} 领跑(份额 ${esc(top.share ?? "—")}%),${esc(launchpadHeatLabel(direction))}</span>`);
}

function tideLeverageLine(d) {
  // Tide and dexCex are independent side/layer channels — compose each honestly instead of
  // letting one channel's "missing" hide the other (OKX+HL can both fail while tide is fine).
  const tide = d.stableTide;
  const dexCex = d.layers?.dexCex;
  const tideText = !tide || tide.dataQuality === "missing"
    ? `<span class="muted">潮汐数据缺失</span>`
    : tide.delta24hPct === null || tide.delta24hPct === undefined
      ? `<span class="muted" title="${esc(HOW.tide)}">${esc(stableTideLabel(tide.direction, tide.points))}</span>`
      : `<span class="${dirClass(tide.direction)}" title="${esc(HOW.tide)}">${esc(stableTideLabel(tide.direction, tide.points))}</span> · 24h <span class="${dirClass(tide.direction)}">${esc(pctSigned(tide.delta24hPct))}</span>`;
  const leverage = layerMissing(dexCex)
    ? ` · <span class="muted">杠杆面(DEX↔CEX)缺失</span>`
    : dexCex.crowding === "high" ? ` · <span class="down">合约拥挤,防挤仓</span>` : "";
  return conclusionLine("潮汐+杠杆", `${tideText}${leverage}`);
}

function actionLine(d) {
  const guidance = d.guidance ?? [];
  if (!guidance.length) return conclusionLine("行动", `<span class="muted">标的建议数据缺失</span>`, "muted");
  const chips = guidance.map((g) => {
    const risks = (g.riskFlags ?? []).length;
    const riskBadge = risks ? `<span class="risk-count down">风险 ${esc(risks)}</span>` : "";
    return `<span><span class="tier tier-${esc(g.tier)}">${esc(g.target)} ${esc(g.tierLabel ?? g.tier)}</span>${riskBadge}</span>`;
  }).join("");
  return conclusionLine("行动", `<span class="action-chips">${chips}</span><span>${esc(tierSummary(guidance) || "暂无可执行档位")}</span>`);
}

function qualityFromData(d, layer) {
  const found = (d.dataHealth?.layers ?? []).find((item) => item.layer === layer);
  const layerData = d.layers?.[layer];
  return {
    dataQuality: found?.dataQuality ?? layerData?.dataQuality ?? "missing",
    confidence: found?.confidence ?? layerData?.confidence ?? "unknown",
  };
}

function relativeUpdate(generatedAt) {
  const time = Date.parse(generatedAt ?? "");
  if (!Number.isFinite(time)) return { text: "更新时间未知", cls: "down", note: "数据时间缺失" };
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  const text = minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : `${Math.floor(minutes / 60)} 小时前`;
  if (minutes > 180) return { text, cls: "down", note: "数据可能滞后" };
  if (minutes > 90) return { text, cls: "warn", note: "数据可能滞后" };
  return { text, cls: "up", note: "" };
}

function trustBar(d) {
  const updated = relativeUpdate(d.meta?.generatedAt);
  const layers = [
    ["macro", "宏观"],
    ["chain", "链间"],
    ["launchpad", "发射台"],
    ["dexCex", "DEX↔CEX"],
    ["narrative", "主题"],
  ];
  const dots = layers.map(([key, label]) => {
    const q = qualityFromData(d, key);
    const status = ["ok", "partial", "missing"].includes(q.dataQuality) ? q.dataQuality : "missing";
    return `<span class="dot dot-${esc(status)}" title="${esc(label)} · ${esc(q.confidence)}"></span>`;
  }).join("");
  const sources = (d.dataHealth?.sourceStatus ?? []).map((s) => `<div>${esc(s.source)}:<span class="${s.status === "ok" ? "up" : "down"}">${esc(s.status)}</span>${s.message ? ` <span>(${esc(s.message)})</span>` : ""}</div>`).join("");
  return `<details class="panel trust-bar">
    <summary>
      <span class="${updated.cls}">更新 ${esc(updated.text)}${updated.note ? ` · ${esc(updated.note)}` : ""}</span>
      <span class="dot-row" aria-label="五层数据质量">${dots}</span>
      <span class="muted">历史 ${esc(d.meta?.historyPoints ?? 0)} 点</span>
      <span class="muted">每小时自动采集·失败源如实标注</span>
    </summary>
    <div class="trust-details">
      <div>${sources || "源状态缺失"}</div>
    </div>
  </details>`;
}

const METRIC_LABEL = { netLiquidityUsdB: "净流动性", walclUsdB: "Fed 资产负债表", tgaUsdB: "TGA", rrpUsdB: "RRP" };
function macroPanel(d) {
  const m = d.layers?.macro;
  if (!m) return "";
  const cells = (m.components ?? []).map((c) => {
    const v = c.value === null || c.value === undefined ? "—" : `$${Number(c.value).toLocaleString()}B`;
    const chg = c.changePct === null || c.changePct === undefined ? ""
      : ` <span class="${c.changePct > 0 ? "up" : c.changePct < 0 ? "down" : "flat"}">(${c.changePct > 0 ? "+" : ""}${esc(c.changePct)}%)</span>`;
    return `<span class="muted">${esc(METRIC_LABEL[c.metric] ?? c.metric)}</span> ${esc(v)}${chg}`;
  }).join(" · ");
  return `<div class="panel">
    <h2>L1 宏观净流动性 · <span class="${dirClass(m.direction)}">${esc(DIR_LABEL[m.direction] ?? m.direction)}</span></h2>
    <div class="how">${esc(HOW.macro)}</div>
    <div>${cells || "—"}</div>
    <div class="muted" style="margin-top:4px">${esc((m.drivers ?? [])[0] ?? "")} · 数据 ${qBadge(m.dataQuality)}</div>
  </div>`;
}

function chainPanel(d) {
  const comps = d.layers?.chain?.components ?? [];
  const rows = comps.length
    ? comps.map((c) => `<tr>
        <td>${esc(c.label ?? c.chain)}</td>
        <td class="num">${pct(c.shareNow)}</td>
        <td class="num ${dirClass(c.direction)}">${c.shareDeltaPp === null || c.shareDeltaPp === undefined ? "—" : `${c.shareDeltaPp > 0 ? "+" : ""}${Number(c.shareDeltaPp).toFixed(3)}pp`}</td>
        <td class="${dirClass(c.direction)}">${esc(DIR_LABEL[c.direction] ?? c.direction)}</td>
        <td>${qBadge(c.dataQuality)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="muted">链间层无数据(provider 失败或未采集)。</td></tr>`;
  return `<div class="panel">
    <h2>L2 链间资金流动 · 稳定币份额</h2>
    <div class="how">${esc(HOW.chain)}</div>
    ${tableScroll(`<table>
      <thead><tr><th>链</th><th class="num">占全局份额</th><th class="num">变化</th><th>方向</th><th>数据</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`)}
  </div>`;
}

function launchpadPanel(d) {
  const lp = d.layers?.launchpad;
  const comps = [...(lp?.components ?? [])].sort((a, b) => (b.revenue24h ?? -1) - (a.revenue24h ?? -1));
  const rows = comps.length
    ? comps.map((c) => `<tr>
        <td>${esc(c.label ?? c.launchpad)} <span class="muted">${esc(c.chain)}</span></td>
        <td class="num">${usd(c.revenue24h)}</td>
        <td class="num">${c.share === null || c.share === undefined ? "—" : `${esc(c.share)}%`}</td>
        <td class="num ${dirClass(c.direction)}">${c.momentum === null || c.momentum === undefined ? "—" : `${c.momentum > 0 ? "+" : ""}${(Number(c.momentum) * 100).toFixed(0)}%`}</td>
        <td class="${dirClass(c.direction)}">${esc(DIR_LABEL[c.direction] ?? c.direction)}</td>
        <td>${qBadge(c.dataQuality)}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="muted">发射台层无数据。</td></tr>`;
  const chainRoll = (lp?.byChain ?? []).map((c) => `${esc(c.chain)} ${usd(c.revenue24h)}(${esc(c.share ?? "—")}%)`).join(" · ");
  const leader = lp?.topLaunchpad ? `龙头 <strong>${esc(lp.topLaunchpad.label)}</strong> ${esc(lp.topLaunchpad.share ?? "—")}%` : "";
  return `<div class="panel">
    <h2>L3 发射台资金流动 · 24h 收入 / 份额 / 动量</h2>
    <div class="how">${esc(HOW.launchpad)}</div>
    <div class="muted" style="margin-bottom:8px">${leader}${chainRoll ? ` · 链分布: ${chainRoll}` : ""}</div>
    ${tableScroll(`<table>
      <thead><tr><th>发射台</th><th class="num">24h 收入</th><th class="num">份额</th><th class="num">动量</th><th>方向</th><th>数据</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`)}
  </div>`;
}

function narrativePanel(d) {
  const comps = d.layers?.narrative?.components ?? [];
  const rows = comps.length
    ? comps.map((c) => `<tr>
        <td>${esc(c.sector)}</td>
        <td class="num">${usd(c.tvl)}</td>
        <td class="num ${dirClass(c.direction)}">${c.change7dPct === null || c.change7dPct === undefined ? "—" : `${c.change7dPct > 0 ? "+" : ""}${esc(c.change7dPct)}%`}</td>
        <td class="${dirClass(c.direction)}">${esc(DIR_LABEL[c.direction] ?? c.direction)}</td>
        <td>${qBadge(c.dataQuality)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="muted">主题层无数据。</td></tr>`;
  const ms = d.layers?.narrative?.mindshare;
  const msBlock = ms
    ? `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">
        <div class="muted" style="font-size:12px">注意力代理 · CoinGecko 热门搜索 — ${esc(ms.note ?? "")}</div>
        <div style="margin-top:4px">热门币 ${(ms.trendingCoins ?? []).slice(0, 8).map((c) => `<span class="q">${esc(c.symbol)}${c.change24hPct != null ? ` <span class="${c.change24hPct > 0 ? "up" : c.change24hPct < 0 ? "down" : "flat"}">${c.change24hPct > 0 ? "+" : ""}${esc(c.change24hPct)}%</span>` : ""}</span>`).join(" ") || "—"}</div>
        <div style="margin-top:4px">热门板块 ${(ms.trendingCategories ?? []).slice(0, 6).map((c) => `<span class="q">${esc(c.name)}</span>`).join(" ") || "—"}</div>
      </div>`
    : "";
  return `<div class="panel">
    <h2>L5 主题/板块轮动 · TVL 7d 相对强弱</h2>
    <div class="how">${esc(HOW.narrative)}</div>
    ${tableScroll(`<table>
      <thead><tr><th>板块</th><th class="num">TVL</th><th class="num">7d</th><th>方向</th><th>数据</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`)}
    ${msBlock}
  </div>`;
}

function appRevenuePanel(d) {
  const h = d.appRevenueHeat;
  if (!h) return "";
  const chains = h.byChain ?? [];
  const rows = chains.flatMap((chain) => {
    const warning = chain.singleAppSpike
      ? `<div class="down">单一协议占比 ${esc(chain.dominantApp?.share ?? "—")}%, 谨慎解读为链级热度。</div>`
      : "";
    if (!(chain.topApps ?? []).length) {
      return [`<tr>
        <td>${esc(chain.label ?? chain.chain)}</td>
        <td colspan="5" class="muted">该链协议收入数据缺失。</td>
        <td>${qBadge(chain.dataQuality)}</td>
      </tr>`];
    }
    return [
      `<tr>
        <td rowspan="${chain.topApps.length}">${esc(chain.label ?? chain.chain)}${warning}</td>
        <td>${esc(chain.topApps[0].protocol)}</td>
        <td class="num">${usd(chain.topApps[0].revenue24h)}</td>
        <td class="num">${chain.topApps[0].share === null || chain.topApps[0].share === undefined ? "—" : `${esc(chain.topApps[0].share)}%`}</td>
        <td class="num ${dirClass(chain.topApps[0].direction)}">${chain.topApps[0].momentum === null || chain.topApps[0].momentum === undefined ? "—" : `${chain.topApps[0].momentum > 0 ? "+" : ""}${(Number(chain.topApps[0].momentum) * 100).toFixed(0)}%`}</td>
        <td class="${dirClass(chain.topApps[0].direction)}">${esc(DIR_LABEL[chain.topApps[0].direction] ?? chain.topApps[0].direction)}</td>
        <td>${qBadge(chain.dataQuality)}</td>
      </tr>`,
      ...chain.topApps.slice(1).map((app) => `<tr>
        <td>${esc(app.protocol)}</td>
        <td class="num">${usd(app.revenue24h)}</td>
        <td class="num">${app.share === null || app.share === undefined ? "—" : `${esc(app.share)}%`}</td>
        <td class="num ${dirClass(app.direction)}">${app.momentum === null || app.momentum === undefined ? "—" : `${app.momentum > 0 ? "+" : ""}${(Number(app.momentum) * 100).toFixed(0)}%`}</td>
        <td class="${dirClass(app.direction)}">${esc(DIR_LABEL[app.direction] ?? app.direction)}</td>
        <td>${qBadge(chain.dataQuality)}</td>
      </tr>`),
    ];
  }).join("");

  return `<div class="panel">
    <h2>辅助 · App 收入热度 · 活动热度,不是流动性/净流入</h2>
    <div class="how">${esc(HOW.appRevenue)}</div>
    <div class="muted" style="margin-bottom:8px">${esc(h.note ?? "协议收入=活动热度,非流动性/净流入")} · 数据 ${qBadge(h.dataQuality)}</div>
    ${tableScroll(`<table>
      <thead><tr><th>链</th><th>协议</th><th class="num">24h 收入</th><th class="num">份额</th><th class="num">动量</th><th>方向</th><th>数据</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="muted">App 收入热度无数据。</td></tr>`}</tbody>
    </table>`)}
  </div>`;
}

function fundingClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "warn" : "up";
}

function dexcexPanel(d) {
  const x = d.layers?.dexCex;
  const rows = (x?.components ?? []).map((c) => `<tr>
      <td>${esc(c.symbol)}</td>
      <td class="num ${fundingClass(c.funding)}">${c.funding === null || c.funding === undefined ? "—" : `${(Number(c.funding) * 100).toFixed(4)}%`}</td>
      <td class="num">${esc(c.perpSpot ?? "—")}</td>
    </tr>`).join("");
  return `<div class="panel">
    <h2>L4 DEX↔CEX · <span class="${dirClass(x?.direction)}">${esc(DIR_LABEL[x?.direction] ?? x?.direction ?? "—")}</span>${x?.crowding === "high" ? ' <span class="down">合约拥挤</span>' : ""}</h2>
    <div class="how">${esc(HOW.dexCex)}</div>
    <div class="muted">perp/spot 量比: ${esc(x?.perpSpotRatio ?? "—")} · 数据 ${qBadge(x?.dataQuality)}</div>
    ${tableScroll(`<table>
      <thead><tr><th>资产</th><th class="num">资金费率</th><th class="num">perp/spot</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">OKX 未采集(可能代理不可达)。</td></tr>`}</tbody>
    </table>`)}
  </div>`;
}

function rotationPanel(d) {
  const edges = d.flowState?.rotationEdges ?? [];
  const body = edges.length
    ? `<ul>${edges.map((e) => `<li class="edge">${esc(e.from)} → ${esc(e.to)} <span class="muted">(${esc(e.type)}, 强度 ${esc(e.strength)}, ${esc(e.confidence)})</span></li>`).join("")}</ul>`
    : `<p class="muted">暂无显著轮动边。${(d.meta?.historyPoints ?? 0) < 2 ? "(历史点不足,需累积多次采集后才能判断迁移)" : ""}</p>`;
  return `<div class="panel"><h2>轮动地图</h2>${body}</div>`;
}

function guidancePanel(d) {
  const rows = (d.guidance ?? []).map((g) => `<tr>
    <td>${esc(g.target)}</td>
    <td class="muted">${g.type === "cex_perp" ? "CEX合约" : "链上现货"}</td>
    <td class="num tier-text-${esc(g.tier)}">${esc(g.conviction)}</td>
    <td><span class="tier tier-${esc(g.tier)}">${esc(g.tierLabel ?? g.tier)}</span></td>
    <td class="tags hide-mobile">${(g.tailwindLayers ?? []).map((t) => esc(t.layer)).join("/") || "—"}</td>
    <td class="tags hide-mobile">${(g.headwindLayers ?? []).map((h) => esc(h.layer)).join("/") || "—"}</td>
    <td class="tags ${g.riskFlags?.length ? "down" : "muted"}">${(g.riskFlags ?? []).map(esc).join("；") || "—"}</td>
    <td>${qBadge(g.dataQuality)}</td>
  </tr>`).join("");
  return `<div class="panel">
    <h2>标的仓位建议(辅助 · 不下单)</h2>
    <div class="how">${esc(HOW.guidance)}</div>
    ${tableScroll(`<table class="guidance-table">
      <thead><tr><th>标的</th><th>类型</th><th class="num">conviction</th><th>仓位档</th><th class="hide-mobile">顺风</th><th class="hide-mobile">逆风</th><th>风险</th><th>数据</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="muted">未配置标的清单。</td></tr>`}</tbody>
    </table>`)}
  </div>`;
}

function healthPanel(d) {
  const layers = (d.dataHealth?.layers ?? []).map((l) => `${esc(l.layer)} ${qBadge(l.dataQuality)} <span class="muted">${esc(l.confidence)}</span>`).join(" · ");
  const sources = (d.dataHealth?.sourceStatus ?? []).map((s) => `${esc(s.source)}:<span class="${s.status === "ok" ? "up" : "down"}">${esc(s.status)}</span>${s.message ? ` <span class="muted">(${esc(s.message)})</span>` : ""}`).join(" · ");
  return `<div class="panel"><h2>数据健康</h2>
    <div>层:${layers || "—"}</div>
    <div style="margin-top:6px">源:${sources || "—"}</div>
  </div>`;
}

main();