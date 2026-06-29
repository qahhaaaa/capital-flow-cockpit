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
const qBadge = (q) => `<span class="q q-${esc(q)}">${esc(q ?? "missing")}</span>`;

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
  const xLabels = model.ticks.map((tick) => `<text class="macro-axis" x="${tick.x}" y="${model.height - 8}" text-anchor="middle">${esc(tick.label)}</text>`).join("");
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
async function main() {
  const app = document.getElementById("app");
  try {
    const res = await fetch("./data/cockpit.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    app.innerHTML = render(await res.json());
    void hydrateMacroContextPanel();
  } catch (error) {
    app.innerHTML = `<p class="err">无法加载 ./data/cockpit.json:${esc(error.message)}。请先运行 <code>npm run collect:cockpit</code>。</p>`;
  }
}

function render(d) {
  return [
    `<div id="macro-context-slot">${macroContextPlaceholder()}</div>`,
    headerPanel(d),
    macroPanel(d),
    `<div class="grid two">${chainPanel(d)}${launchpadPanel(d)}</div>`,
    `<div class="grid two">${narrativePanel(d)}${dexcexPanel(d)}</div>`,
    appRevenuePanel(d),
    rotationPanel(d),
    guidancePanel(d),
    healthPanel(d),
    `<footer>schema ${esc(d.schema)} · 生成于 ${esc(d.meta?.generatedAt ?? "—")} · 历史点 ${esc(d.meta?.historyPoints ?? 0)}</footer>`,
  ].join("");
}

function headerPanel(d) {
  const r = d.regime ?? "unknown";
  return `<div class="panel">
    <div class="regime">
      <span>宏观水位:</span><span class="badge b-${esc(r)}">${esc(REGIME_LABEL[r] ?? r)}</span>
      <span class="muted">钱主要在:</span><strong>${esc(d.moneyLocation ?? "—")}</strong>
      <span class="muted">一致度:</span><span>${esc(d.flowState?.agreement?.net ?? "—")}</span>
    </div>
    <div class="advisory">${esc(d.advisory ?? "辅助判断,不构成下单指令。")}</div>
  </div>`;
}

function chainPanel(d) {
  const comps = d.layers?.chain?.components ?? [];
  const rows = comps.length
    ? comps.map((c) => `<tr>
        <td>${esc(c.label ?? c.chain)}</td>
        <td class="num">${pct(c.shareNow)}</td>
        <td class="num ${dirClass(c.direction)}">${c.shareDeltaPp === null || c.shareDeltaPp === undefined ? "—" : (c.shareDeltaPp > 0 ? "+" : "") + Number(c.shareDeltaPp).toFixed(3) + "pp"}</td>
        <td class="${dirClass(c.direction)}">${esc(DIR_LABEL[c.direction] ?? c.direction)}</td>
        <td>${qBadge(c.dataQuality)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="muted">链间层无数据(provider 失败或未采集)。</td></tr>`;
  return `<div class="panel">
    <h2>L2 链间资金流动 · 稳定币份额</h2>
    <table>
      <thead><tr><th>链</th><th class="num">占全局份额</th><th class="num">变化</th><th>方向</th><th>数据</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

const METRIC_LABEL = { netLiquidityUsdB: "净流动性", walclUsdB: "Fed 资产负债表", tgaUsdB: "TGA", rrpUsdB: "RRP" };
function macroPanel(d) {
  const m = d.layers?.macro;
  if (!m) return "";
  const cells = (m.components ?? []).map((c) => {
    const v = c.value === null || c.value === undefined ? "—" : `$${Number(c.value).toLocaleString()}B`;
    const chg = c.changePct === null || c.changePct === undefined ? ""
      : ` <span class="${c.changePct > 0 ? "up" : c.changePct < 0 ? "down" : "flat"}">(${c.changePct > 0 ? "+" : ""}${c.changePct}%)</span>`;
    return `<span class="muted">${esc(METRIC_LABEL[c.metric] ?? c.metric)}</span> ${v}${chg}`;
  }).join(" · ");
  return `<div class="panel">
    <h2>L1 宏观净流动性 · <span class="${dirClass(m.direction)}">${esc(DIR_LABEL[m.direction] ?? m.direction)}</span></h2>
    <div>${cells || "—"}</div>
    <div class="muted" style="margin-top:4px">${esc((m.drivers ?? [])[0] ?? "")} · 数据 ${qBadge(m.dataQuality)}</div>
  </div>`;
}

function launchpadPanel(d) {
  const lp = d.layers?.launchpad;
  const comps = [...(lp?.components ?? [])].sort((a, b) => (b.revenue24h ?? -1) - (a.revenue24h ?? -1));
  const rows = comps.length
    ? comps.map((c) => `<tr>
        <td>${esc(c.label ?? c.launchpad)} <span class="muted">${esc(c.chain)}</span></td>
        <td class="num">${usd(c.revenue24h)}</td>
        <td class="num">${c.share === null || c.share === undefined ? "—" : c.share + "%"}</td>
        <td class="num ${dirClass(c.direction)}">${c.momentum === null || c.momentum === undefined ? "—" : (c.momentum > 0 ? "+" : "") + (Number(c.momentum) * 100).toFixed(0) + "%"}</td>
        <td class="${dirClass(c.direction)}">${esc(DIR_LABEL[c.direction] ?? c.direction)}</td>
        <td>${qBadge(c.dataQuality)}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="muted">发射台层无数据。</td></tr>`;
  const chainRoll = (lp?.byChain ?? []).map((c) => `${esc(c.chain)} ${usd(c.revenue24h)}(${c.share ?? "—"}%)`).join(" · ");
  const leader = lp?.topLaunchpad ? `龙头 <strong>${esc(lp.topLaunchpad.label)}</strong> ${lp.topLaunchpad.share ?? "—"}%` : "";
  return `<div class="panel">
    <h2>L3 发射台资金流动 · 24h 收入 / 份额 / 动量</h2>
    <div class="muted" style="margin-bottom:8px">${leader}${chainRoll ? ` · 链分布: ${chainRoll}` : ""}</div>
    <table>
      <thead><tr><th>发射台</th><th class="num">24h 收入</th><th class="num">份额</th><th class="num">动量</th><th>方向</th><th>数据</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function narrativePanel(d) {
  const comps = d.layers?.narrative?.components ?? [];
  const rows = comps.length
    ? comps.map((c) => `<tr>
        <td>${esc(c.sector)}</td>
        <td class="num">${usd(c.tvl)}</td>
        <td class="num ${dirClass(c.direction)}">${c.change7dPct === null || c.change7dPct === undefined ? "—" : (c.change7dPct > 0 ? "+" : "") + c.change7dPct + "%"}</td>
        <td class="${dirClass(c.direction)}">${esc(DIR_LABEL[c.direction] ?? c.direction)}</td>
        <td>${qBadge(c.dataQuality)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="muted">主题层无数据。</td></tr>`;
  const ms = d.layers?.narrative?.mindshare;
  const msBlock = ms
    ? `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">
        <div class="muted" style="font-size:12px">注意力代理 · CoinGecko 热门搜索 — ${esc(ms.note ?? "")}</div>
        <div style="margin-top:4px">热门币 ${(ms.trendingCoins ?? []).slice(0, 8).map((c) => `<span class="q">${esc(c.symbol)}${c.change24hPct != null ? ` <span class="${c.change24hPct > 0 ? "up" : c.change24hPct < 0 ? "down" : "flat"}">${c.change24hPct > 0 ? "+" : ""}${c.change24hPct}%</span>` : ""}</span>`).join(" ") || "—"}</div>
        <div style="margin-top:4px">热门板块 ${(ms.trendingCategories ?? []).slice(0, 6).map((c) => `<span class="q">${esc(c.name)}</span>`).join(" ") || "—"}</div>
      </div>`
    : "";
  return `<div class="panel">
    <h2>L5 主题/板块轮动 · TVL 7d 相对强弱</h2>
    <table>
      <thead><tr><th>板块</th><th class="num">TVL</th><th class="num">7d</th><th>方向</th><th>数据</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${msBlock}
  </div>`;
}

function appRevenuePanel(d) {
  const h = d.appRevenueHeat;
  if (!h) return "";
  const chains = h.byChain ?? [];
  const rows = chains.flatMap((chain) => {
    const warning = chain.singleAppSpike
      ? `<div class="down">单一协议占比 ${chain.dominantApp?.share ?? "—"}%, 谨慎解读为链级热度。</div>`
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
        <td class="num">${chain.topApps[0].share === null || chain.topApps[0].share === undefined ? "—" : chain.topApps[0].share + "%"}</td>
        <td class="num ${dirClass(chain.topApps[0].direction)}">${chain.topApps[0].momentum === null || chain.topApps[0].momentum === undefined ? "—" : (chain.topApps[0].momentum > 0 ? "+" : "") + (Number(chain.topApps[0].momentum) * 100).toFixed(0) + "%"}</td>
        <td class="${dirClass(chain.topApps[0].direction)}">${esc(DIR_LABEL[chain.topApps[0].direction] ?? chain.topApps[0].direction)}</td>
        <td>${qBadge(chain.dataQuality)}</td>
      </tr>`,
      ...chain.topApps.slice(1).map((app) => `<tr>
        <td>${esc(app.protocol)}</td>
        <td class="num">${usd(app.revenue24h)}</td>
        <td class="num">${app.share === null || app.share === undefined ? "—" : app.share + "%"}</td>
        <td class="num ${dirClass(app.direction)}">${app.momentum === null || app.momentum === undefined ? "—" : (app.momentum > 0 ? "+" : "") + (Number(app.momentum) * 100).toFixed(0) + "%"}</td>
        <td class="${dirClass(app.direction)}">${esc(DIR_LABEL[app.direction] ?? app.direction)}</td>
        <td>${qBadge(chain.dataQuality)}</td>
      </tr>`),
    ];
  }).join("");

  return `<div class="panel">
    <h2>辅助 · App 收入热度 · 活动热度,不是流动性/净流入</h2>
    <div class="muted" style="margin-bottom:8px">${esc(h.note ?? "协议收入=活动热度,非流动性/净流入")} · 数据 ${qBadge(h.dataQuality)}</div>
    <table>
      <thead><tr><th>链</th><th>协议</th><th class="num">24h 收入</th><th class="num">份额</th><th class="num">动量</th><th>方向</th><th>数据</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="muted">App 收入热度无数据。</td></tr>`}</tbody>
    </table>
  </div>`;
}

function dexcexPanel(d) {
  const x = d.layers?.dexCex;
  const rows = (x?.components ?? []).map((c) => `<tr>
      <td>${esc(c.symbol)}</td>
      <td class="num">${c.funding === null || c.funding === undefined ? "—" : (Number(c.funding) * 100).toFixed(4) + "%"}</td>
      <td class="num">${c.perpSpot ?? "—"}</td>
    </tr>`).join("");
  return `<div class="panel">
    <h2>L4 DEX↔CEX · <span class="${dirClass(x?.direction)}">${esc(DIR_LABEL[x?.direction] ?? x?.direction ?? "—")}</span>${x?.crowding === "high" ? ' <span class="down">合约拥挤</span>' : ""}</h2>
    <div class="muted">perp/spot 量比: ${x?.perpSpotRatio ?? "—"} · 数据 ${qBadge(x?.dataQuality)}</div>
    <table>
      <thead><tr><th>资产</th><th class="num">资金费率</th><th class="num">perp/spot</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">OKX 未采集(可能代理不可达)。</td></tr>`}</tbody>
    </table>
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
    <td class="num">${esc(g.conviction)}</td>
    <td><span class="tier tier-${esc(g.tier)}">${esc(g.tierLabel ?? g.tier)}</span></td>
    <td class="tags">${(g.tailwindLayers ?? []).map((t) => esc(t.layer)).join("/") || "—"}</td>
    <td class="tags">${(g.headwindLayers ?? []).map((h) => esc(h.layer)).join("/") || "—"}</td>
    <td class="tags ${g.riskFlags?.length ? "down" : "muted"}">${(g.riskFlags ?? []).map(esc).join("；") || "—"}</td>
    <td>${qBadge(g.dataQuality)}</td>
  </tr>`).join("");
  return `<div class="panel">
    <h2>标的仓位建议(辅助 · 不下单)</h2>
    <table>
      <thead><tr><th>标的</th><th>类型</th><th class="num">conviction</th><th>仓位档</th><th>顺风</th><th>逆风</th><th>风险</th><th>数据</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="muted">未配置标的清单。</td></tr>`}</tbody>
    </table>
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
