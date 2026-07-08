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
const CHAIN_LABEL = { solana: "SOL", ethereum: "ETH", base: "Base", bsc: "BSC", robinhood: "Robinhood" };
const dirClass = (d) => (["inflow", "heating", "rotate_in", "to_spot", "risk_on"].includes(d) ? "up"
  : ["outflow", "cooling", "rotate_out", "to_perp", "risk_off"].includes(d) ? "down" : "flat");

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}%`);
// 金额:中文万/亿/万亿单位(中文读者一眼可读),保留 $ 表明美元。
const usd = (v) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v); if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n); const sign = n < 0 ? "-" : "";
  const trim = (x) => String(Number(x.toFixed(2))); // 5.84→5.84, 22.00→22, 356.80→356.8
  if (a >= 1e12) return `${sign}$${trim(a / 1e12)}万亿`;
  if (a >= 1e8) return `${sign}$${trim(a / 1e8)}亿`;
  if (a >= 1e4) return `${sign}$${trim(a / 1e4)}万`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
};
// 代币价格:绝不把不足 $1 的价格抹成 $0——按量级保留有效位。
const price = (v) => {
  if (v === null || v === undefined) return "—";
  const n = Number(v); if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1000) return usd(n);
  if (a >= 1) return `$${n.toFixed(2)}`;
  if (a >= 0.01) return `$${n.toFixed(4)}`;
  if (a >= 0.0001) return `$${n.toFixed(6)}`;
  if (a > 0) return `$${n.toPrecision(2)}`;
  return "$0";
};
const ratio = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toFixed(1)}×`);
const countCn = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toLocaleString("en-US")} 笔`);
// OKX/HL 资金费率是每 8h 的费率 → 年化(×3/日 ×365)才是人能理解的"持仓成本/年"。
const fundingAnnual = (v) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const yr = Number(v) * 3 * 365 * 100;
  return `${yr > 0 ? "+" : ""}${yr.toFixed(1)}%/年`;
};
const relTime = (iso) => {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "—";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  return min < 1 ? "刚刚" : min < 60 ? `${min} 分钟前` : min < 1440 ? `${Math.floor(min / 60)} 小时前` : `${Math.floor(min / 1440)} 天前`;
};
const qBadge = (q) => {
  const value = q ?? "missing";
  return `<span class="q q-${esc(value)}">${esc(value)}</span>`;
};
const chainLabel = (chainTag) => CHAIN_LABEL[chainTag] ?? chainTag;
const chainChip = (chainTag) => chainTag ? `<span class="chain-chip">${esc(chainLabel(chainTag))}</span>` : "";
// GMGN 链 slug(仅这四条支持);未知链→无跳转链接。
const GMGN_CHAIN = { solana: "sol", ethereum: "eth", base: "base", bsc: "bsc" };
const gmgnUrl = (chainTag, ca) => {
  const slug = GMGN_CHAIN[chainTag];
  return slug && typeof ca === "string" && ca ? `https://gmgn.ai/${slug}/token/${encodeURIComponent(ca)}` : null;
};
const shortCa = (ca) => {
  const value = String(ca ?? "");
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
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
    setupGuidanceDetails();
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

function setupGuidanceDetails() {
  document.querySelectorAll(".guidance-main-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button,a")) return;
      toggleGuidanceDetail(row.dataset.guidanceIndex);
    });
  });
  document.querySelectorAll(".guidance-toggle").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleGuidanceDetail(button.dataset.guidanceIndex);
    });
  });
  document.querySelectorAll(".copy-btn[data-ca]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void handleCopyCa(button);
    });
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

async function handleCopyCa(button) {
  const ca = button.dataset.ca;
  if (!ca) return;
  const original = button.textContent;
  button.disabled = true;
  try {
    await copyText(ca);
    button.textContent = "已复制";
  } catch {
    button.textContent = "复制失败";
  }
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1500);
}

function toggleGuidanceDetail(index) {
  const detail = document.querySelector(`[data-guidance-detail="${index}"]`);
  const button = document.querySelector(`.guidance-toggle[data-guidance-index="${index}"]`);
  if (!detail) return;
  const expanded = detail.style.display === "table-row";
  detail.style.display = expanded ? "none" : "table-row";
  if (button) {
    button.setAttribute("aria-expanded", expanded ? "false" : "true");
    button.textContent = expanded ? "+" : "-";
  }
}

function render(d) {
  return [
    conclusionPanel(d),
    trustBar(d),
    rotationPanel(d),
    chainPanel(d),
    guidancePanel(d),
    `<div class="grid two">${launchpadPanel(d)}${dexcexPanel(d)}</div>`,
    narrativePanel(d),
    macroPanel(d),
    appRevenuePanel(d),
    healthPanel(d),
    macroContextDetails(),
    `<footer><a href="./guide.html">📖 怎么看这张面板</a> · schema ${esc(d.schema)} · 更新于 ${esc(relTime(d.meta?.generatedAt))} · 历史点 ${esc(d.meta?.historyPoints ?? 0)}</footer>`,
  ].join("");
}

const pctSigned = (v) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`);
const ppSigned = (v, digits = 2) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(digits)}pp`);
const tableScroll = (table) => `<div class="table-scroll">${table}</div>`;
const HOW = {
  macro: "净流动性=美联储资产负债表−TGA−RRP;上行=放水利好风险资产,收水时引擎自动压制所有仓位建议",
  chain: "份额Δ=存量迁移(稳定币);DEX量动量=流量热度;费用动量=链上活动;方向由三者加权(0.5/0.3/0.2),轮动边需份额+DEX量双确认;拐点=慢漂移警报",
  launchpad: "24h 收入=打新热度的真金白银;动量>0=升温;份额=占五台总收入比;龙头=当前打新主战场",
  dexCex: "funding>0=多头付费=资金挤在合约(过热防挤仓);偏现货=承接型资金更健康;来源 OKX,451 时自动切 Hyperliquid(无现货腿标 partial)——闸门信号，不指导单一标的",
  narrative: "板块 7d TVL 相对强弱=叙事资金轮动;热门搜索仅是注意力代理,可被操纵,不入引擎",
  tide: "稳定币总市值变化=钱进出 crypto 整个池子;与链间份额(池内轮动)独立——闸门信号，不指导单一标的",
  appRevenue: "协议收入=活动热度,不是流动性也不是净流入;单协议占比>60% 会标记单点尖刺",
  guidance: "conviction 由各层方向×强度×置信度加权,宏观收水封顶试探;顺风/逆风=支持/反对该标的的层;每条风险降一档",
};

// 字段说明:每表下方可展开的「表头=精确含义」清单。移动端 title 悬停不出 → 用 tap 可见的 details 消歧义。
// defs=[[列名,含义],...](含义为静态作者文案,允许简单标记);note=可选醒目口径提示。
function fieldNote(defs, note = "") {
  const rows = defs.map(([k, v]) => `<div class="fn-row"><span class="fn-k">${esc(k)}</span><span class="fn-v">${v}</span></div>`).join("");
  return `<details class="field-note"><summary>字段说明 · 点击展开</summary><div class="fn-body">${rows}</div>${note ? `<div class="fn-note">${note}</div>` : ""}</details>`;
}

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

// Rotation edge stage: 已确认(24h agrees)=green, 早期(fast-only heads-up)=yellow; slowFollow badge.
function rotationStageBadge(edge) {
  if (!edge || !edge.stage) return "";
  const confirmed = edge.stage === "confirmed";
  const follow = edge.slowFollow ? ' · <span class="up">慢钱跟进</span>' : "";
  return `<span class="${confirmed ? "up" : "warn"}">【${confirmed ? "已确认" : "早期·待确认"}】</span>${follow}`;
}

// Persistence signature (durability): 结构性>持续>闪现 + 方向前缀(流入/外流,消歧义)+ streak +
// breadth(N/4 时间窗同向)+ momentum. Not a forecast.
const momWord = (m) => (m === "building" ? "增强" : m === "fading" ? "减弱" : "持平");
const persistArrow = (m) => (m === "building" ? "↑" : m === "fading" ? "↓" : "");
const persistCls = (label) => (label.startsWith("结构性") ? "up" : label.startsWith("持续") ? "warn" : label.startsWith("闪现") ? "down" : "muted");
const persistDir = (direction) => (direction === "inflow" ? "流入" : direction === "outflow" ? "外流" : "");
const persistTitle = (p, prefix) => `方向:${prefix || "—"} · 持续性:${p.label} · 已持续:${p.hours ?? 0}h · 动量:${momWord(p.momentum)} · 广度:${p.breadth ?? 0}/4(1h/6h/24h/7d 中与当前方向一致的时间窗数,越多越可信)${p.slowFollow ? " · 慢钱跟进" : ""}`;

// 徽章形态(用于轮动边,目的地恒为流入)。
function persistenceBadge(p) {
  if (!p || !p.label || p.label === "无显著流向") return "";
  const br = p.breadth != null ? `·${p.breadth}/4窗` : "";
  return ` <span class="${persistCls(p.label)}" title="${esc(persistTitle(p, "流入"))}">持续性:流入·${esc(p.label)}${p.hours ? "·" + esc(p.hours) + "h" : ""}${persistArrow(p.momentum)}${br}</span>`;
}

// 交易热钱(6h/24hDEX 放量)vs 费用驱动(交易冷、靠协议费用);费用尖刺=单协议主导已折价。
function flowTypeBadge(e) {
  if (e.type !== "chain" || !e.flowType) return "";
  const trading = e.flowType === "trading";
  const spike = e.feeSpike ? ` <span class="warn">⚠${esc(e.feeSpike.protocol ?? "单协议")}${esc(e.feeSpike.share)}%</span>` : "";
  return ` <span class="${trading ? "up" : "warn"}">[${trading ? "交易热钱" : "费用驱动"}]</span>${spike}`;
}

function chainConclusionLine(d) {
  const chain = d.layers?.chain;
  if (layerMissing(chain)) return conclusionLine("链间", `<span class="muted">链间层数据缺失</span>`, "muted");
  const comps = chain.components ?? [];
  // composite direction now (份额+DEX量+费用[+6h快]),不再只看稳定币存量份额
  const inflow = comps
    .filter((c) => c.direction === "inflow")
    .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))[0];
  const allFlat = comps.length > 0 && comps.every((c) => ["flat", "unknown"].includes(c.direction));
  const inflections = comps
    .filter((c) => c.inflection === "up" || c.inflection === "down")
    .map((c) => `${esc(c.label ?? c.chain)}${c.inflection === "up" ? "↑" : "↓"}`);
  // flowState.rotationEdges aggregates ALL layers (launchpad edges included) — the chain
  // line must only show chain-type edges or it contradicts its own "无显著迁移" text.
  const edges = (d.flowState?.rotationEdges ?? chain.rotationEdges ?? []).filter((e) => e?.type === "chain");
  const edge = edges[0];
  const main = inflow
    ? `钱在流入 ${esc(inflow.label ?? inflow.chain)}`
    : allFlat ? "链间无显著迁移" : "链间迁移方向不明";
  const edgeText = edge ? ` · <span class="edge">轮动 ${esc(chainLabel(edge.from))}→${esc(chainLabel(edge.to))}</span> ${rotationStageBadge(edge)}${persistenceBadge(edge.persistence)}` : "";
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
    // metrics 里的宏观数值单位是"十亿美元"(B) → ×1e9 还原成美元再走 usd() 的万亿/亿格式。
    const v = c.value === null || c.value === undefined ? "—" : usd(Number(c.value) * 1e9);
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

// 每链持续性列:方向前缀(流入/外流,消歧义)+ tier + 已持续Nh + 动量箭头 + 广度N/4窗;悬停看全解释。
function persistCell(p, direction) {
  if (!p || !p.label || p.label === "无显著流向") return "—";
  const prefix = persistDir(direction);
  const br = p.breadth != null ? `·${p.breadth}/4窗` : "";
  return `<span class="${persistCls(p.label)}" title="${esc(persistTitle(p, prefix))}">${prefix ? prefix + "·" : ""}${esc(p.label)}${p.hours ? "·" + esc(p.hours) + "h" : ""}${persistArrow(p.momentum)}${br}</span>`;
}

function chainPanel(d) {
  const comps = d.layers?.chain?.components ?? [];
  const dexCell = (v, meta = {}) => {
    if (v === null || v === undefined) return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const cls = n > 3 ? "up" : n < -3 ? "down" : "flat";
    if (!meta.untrusted) return `<span class="${cls}">${pctSigned(n)}</span>`;
    const raw = Number(meta.rawPct);
    const rawText = Number.isFinite(raw) ? pctSigned(raw) : "异常值";
    const marker = n > 0 ? "≫" : "≪";
    const title = `原始 7d 变化 ${rawText}, 超过 ±1000%, 低基数导致失真`;
    return `<span class="${cls}" title="${esc(title)}">${marker}${pctSigned(n)}</span> <span class="warn" title="${esc(title)}">${esc(meta.note ?? "新链·基数低")}</span>`;
  };
  const feeCell = (c) => {
    const v = c.feesMomentum;
    const base = v === null || v === undefined ? "—" : `<span class="${v > 0.05 ? "up" : v < -0.05 ? "down" : "flat"}">${v > 0 ? "+" : ""}${(Number(v) * 100).toFixed(0)}%</span>`;
    return base + (c.feeSpike ? ` <span class="warn" title="单协议 ${esc(c.feeSpike.protocol ?? "")} 主导费用 ${esc(c.feeSpike.share)}%,已折价">⚠</span>` : "");
  };
  const dirCell = (c) => `<span class="${dirClass(c.direction)}">${esc(DIR_LABEL[c.direction] ?? c.direction)}</span>${c.flowType === "fee" ? ' <span class="warn">费用</span>' : c.flowType === "trading" ? ' <span class="up">交易</span>' : ""}`;
  // 6h 是比率(0.39=+39%,近6h vs 全天均速);×100 转百分比,死区 ±10% 同 ACCEL_DEADBAND。
  const accelCell = (r) => (r === null || r === undefined ? "—" : `<span class="${r > 0.1 ? "up" : r < -0.1 ? "down" : "flat"}">${pctSigned(Number(r) * 100)}</span>`);
  const rows = comps.length
    ? comps.map((c) => `<tr>
        <td>${esc(c.label ?? c.chain)}</td>
        <td class="num">${pct(c.shareNow)}</td>
        <td class="num ${dirClass(c.direction)}">${c.shareDeltaPp === null || c.shareDeltaPp === undefined ? "—" : `${c.shareDeltaPp > 0 ? "+" : ""}${Number(c.shareDeltaPp).toFixed(3)}pp`}</td>
        <td class="num" style="white-space:nowrap">${usd(c.dexVol24hUsd)}</td>
        <td class="num">${accelCell(c.accel6h)}</td>
        <td class="num">${dexCell(c.dexVolChange1dPct)}</td>
        <td class="num">${dexCell(c.dexVolChange7dPct, { untrusted: c.dexVolChange7dUntrusted, rawPct: c.dexVolChange7dRawPct, note: c.dexVolChange7dNote })}</td>
        <td class="num">${feeCell(c)}</td>
        <td>${dirCell(c)}</td>
        <td>${persistCell(c.persistence, c.direction)}</td>
        <td>${qBadge(c.dataQuality)}</td>
      </tr>`).join("")
    : `<tr><td colspan="11" class="muted">链间层无数据(provider 失败或未采集)。</td></tr>`;
  return `<div class="panel">
    <h2>L2 链间资金流动 · 份额+DEX量+费用</h2>
    <div class="how">${esc(HOW.chain)}</div>
    ${tableScroll(`<table>
      <thead><tr><th title="公链(Solana/Base/以太坊/BSC/Robinhood)">链</th><th class="num" title="该链稳定币存量占所列链总量的比例(存量,慢变量)">份额</th><th class="num" title="份额较上一快照的变化,pp=百分点;正=稳定币在往这条链搬(慢钱)">份额Δ</th><th class="num" title="24h DEX 绝对成交额(DeFiLlama)">量24h</th><th class="num" title="近6h成交 vs 全天均速的加速;免费源无12h,用6h替代">6h</th><th class="num" title="24h DEX 量环比(DeFiLlama change_1d)">24h</th><th class="num" title="7d DEX 量变化(DeFiLlama change_7d);免费源无3d,用7d替代">7d</th><th class="num" title="协议收入(DeFiLlama revenue)按占比加权的升温/降温;⚠=单协议占>60%已折价">费用动量</th><th title="多时间轴综合分判定;交易=真热钱放量,费用=仅靠协议费用">方向</th><th title="当前热度形态(非预测);前缀=方向,N/4窗=1h/6h/24h/7d同向数">持续性</th><th title="ok=全源到位 / partial=部分缺 / missing=全缺">数据</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`)}
    ${fieldNote([
      ["链", "公链:Solana / Base / 以太坊主网 / BSC / Robinhood。"],
      ["份额", "该链稳定币<strong>存量</strong>占所列链总量的比例(慢变量,代表沉淀资金)。"],
      ["份额Δ", "份额较上一快照的变化(pp=百分点)。正=稳定币在往这条链搬=慢钱跟进。"],
      ["量24h", "该链 24h DEX <strong>绝对成交额</strong>(DeFiLlama)。"],
      ["6h", "近 6h 成交 vs 全天均速的<strong>加速</strong>(±10% 才算显著)。<strong>替 12h</strong>——免费源无 12h。"],
      ["24h", "DEX 量日环比(DeFiLlama change_1d)。"],
      ["7d", "DEX 量 7 天变化。<strong>替 3d</strong>——免费源无 3d；超过 ±1000% 时显示限幅值并标 <strong>新链·基数低</strong>。"],
      ["费用动量", "该链各协议<strong>收入</strong>(DeFiLlama revenue)按占比加权的升温/降温;⚠=单协议占>60%,已折价去噪。"],
      ["方向", "多时间轴综合分(6h/24h/存量,0.45/0.35/0.20)判:净流入/净流出/持平。<span class='up'>交易</span>=真热钱放量,<span class='warn'>费用</span>=交易冷、仅靠协议费用。"],
      ["持续性", "当前热度形态(<strong>非未来预测</strong>):闪现(日内)/持续(1-3d)/结构性(多日)/积累中。前缀 流入/外流=方向,N/4窗=1h/6h/24h/7d 中同向的时间窗数。"],
      ["数据", "数据质量:ok=全源到位 / partial=部分源缺 / missing=全缺。"],
    ], "口径:<strong>12h/3d 任何免费源都没有</strong>(DeFiLlama 日粒度只有 24h/7d/30d;GeckoTerminal 只有 1h/6h/24h)→ 用 6h 替 12h、7d 替 3d,不硬凑。")}
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
      <thead><tr><th title="打新/发币平台 + 所在链">发射台</th><th class="num" title="平台 24h 真实收入(DeFiLlama fees, dailyRevenue)=打新热度真金白银">24h 收入</th><th class="num" title="占五台总收入的比例">份额</th><th class="num" title="最新24h收入 vs 前7d日均;>0=升温">动量</th><th title="升温/降温/持平(动量方向,含体量门槛)">方向</th><th title="ok / partial / missing">数据</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`)}
    ${fieldNote([
      ["发射台", "打新/发币平台(pump.fun / BONK.fun / four.meme 等)+ 所在链。"],
      ["24h 收入", "平台 24h <strong>真实收入</strong>(DeFiLlama fees,dataType=dailyRevenue)——打新热度的真金白银。"],
      ["份额", "该平台占五台<strong>总收入</strong>的比例。"],
      ["动量", "最新 24h 收入 vs 前 7d 日均。>0=升温,<0=降温。"],
      ["方向", "升温 / 降温 / 持平(按动量方向,附体量门槛过滤小台噪声)。"],
      ["数据", "ok=全源到位 / partial=部分缺 / missing=全缺。"],
    ])}
  </div>`;
}

// 板块轮动「推导过程 + 支持数据」——把方向阈值、强度分位、TVL 加权、成分协议、口径警告都摊开。
function narrativeDerivation(nv) {
  const comps = nv?.components ?? [];
  if (!comps.length) return "";
  const eps = nv.eps7dPct ?? 2;
  const edge = (nv.rotationEdges ?? [])[0];
  const edgeText = edge
    ? `<div><strong>轮动边推导</strong>:<span class="up">${esc(edge.to)}</span>(轮入端 ${esc(pctSigned(edge.toChange))})← <span class="down">${esc(edge.from)}</span>(轮出端 ${esc(pctSigned(edge.fromChange))}),强度=两端 7d 差值 ${esc(edge.strength)}。</div>`
    : `<div><strong>轮动边推导</strong>:最强/最弱板块未同时突破 ±${esc(eps)}% 阈值 → 不画板块轮动边(诚实)。</div>`;
  const perSector = comps.map((c) => {
    const dirText = c.direction === "rotate_in" ? `轮入(7d ${esc(pctSigned(c.change7dPct))} > +${esc(eps)}%)`
      : c.direction === "rotate_out" ? `轮出(7d ${esc(pctSigned(c.change7dPct))} < −${esc(eps)}%)`
      : c.direction === "flat" ? `持平(|7d| ≤ ${esc(eps)}%)` : "数据缺失";
    const protos = (c.topProtocols ?? []).map((p) => `${esc(p.name)} ${esc(usd(p.tvl))} <span class="${p.change7dPct > 0 ? "up" : p.change7dPct < 0 ? "down" : "flat"}">${esc(pctSigned(p.change7dPct))}</span>`).join("、") || "—";
    return `<div class="sector-deriv"><div><strong>${esc(c.sector)}</strong> — ${dirText};强度 ${esc(c.strength ?? "—")} 分位${c.protocolCount ? ` · 共 ${esc(c.protocolCount)} 协议` : ""}</div><div class="muted">支持协议(按 TVL):${protos}</div></div>`;
  }).join("");
  return `<details class="deriv"><summary>推导过程 + 支持数据(点击展开)</summary>
    <div class="deriv-body">
      <div class="muted">规则:板块 7d = 板块内各协议按 TVL 加权的 7d TVL 变化(大协议主导);方向 = 与 ±${esc(eps)}% 死区比较;强度 = 该板块 |7d| 在所有板块中的分位。</div>
      ${edgeText}
      ${perSector}
      <div class="muted" style="border-top:1px solid var(--line);padding-top:6px">⚠ 口径:USD-TVL 含币价噪声(成分币普涨会虚增 TVL 变化,非真实资金流入),BTC/ETH 计价去噪为后续;热门搜索是注意力代理、可刷量,不进引擎。</div>
    </div>
  </details>`;
}

function narrativePanel(d) {
  const nv = d.layers?.narrative;
  const comps = nv?.components ?? [];
  const oneD = (v) => (v === null || v === undefined ? "—" : `<span class="${v > 0 ? "up" : v < 0 ? "down" : "flat"}">${v > 0 ? "+" : ""}${esc(v)}%</span>`);
  const rows = comps.length
    ? comps.map((c) => `<tr>
        <td>${esc(c.sector)}</td>
        <td class="num">${usd(c.tvl)}</td>
        <td class="num ${dirClass(c.direction)}">${c.change7dPct === null || c.change7dPct === undefined ? "—" : `${c.change7dPct > 0 ? "+" : ""}${esc(c.change7dPct)}%`}</td>
        <td class="num">${oneD(c.change1dPct)}</td>
        <td class="num">${esc(c.strength ?? "—")}</td>
        <td class="${dirClass(c.direction)}">${esc(DIR_LABEL[c.direction] ?? c.direction)}</td>
        <td>${qBadge(c.dataQuality)}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="muted">主题层无数据。</td></tr>`;
  const ms = nv?.mindshare;
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
      <thead><tr><th title="DeFiLlama 板块/叙事分类(如 DEX、借贷、LSD)">板块</th><th class="num" title="板块总锁仓量(含币价噪声)">TVL</th><th class="num" title="板块 7d TVL 相对变化——叙事资金轮动主信号">7d</th><th class="num" title="板块 1d TVL 变化">1d</th><th class="num" title="该板块 7d 变化在所有板块中的分位(0-100,越高越强)">强度</th><th title="走强/走弱/持平(7d 变化 ±2% 死区)">方向</th><th title="ok / partial / missing">数据</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`)}
    ${fieldNote([
      ["板块", "DeFiLlama 板块/叙事分类(如 DEX、借贷 Lending、LSD、RWA)。"],
      ["TVL", "板块总锁仓量。<strong>含币价噪声</strong>(USD 计价,币价涨也会抬 TVL)。"],
      ["7d", "板块 7d TVL 相对变化——<strong>叙事资金轮动的主信号</strong>。"],
      ["1d", "板块 1d TVL 变化(短窗参考)。"],
      ["强度", "该板块 7d 变化在所有板块中的<strong>分位</strong>(0-100,越高越强)。"],
      ["方向", "走强 / 走弱 / 持平(7d 加权变化 vs ±2% 死区)。"],
      ["数据", "ok=全源到位 / partial=部分缺 / missing=全缺。"],
    ], "热门搜索(下方)仅是<strong>注意力代理</strong>,可被操纵,不进引擎。")}
    ${narrativeDerivation(nv)}
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
      <thead><tr><th title="公链">链</th><th title="该链收入 top 协议">协议</th><th class="num" title="协议 24h 收入(DeFiLlama revenue)">24h 收入</th><th class="num" title="占该链总收入的比例">份额</th><th class="num" title="24h 收入 vs 前7d日均;>0=升温">动量</th><th title="升温/降温/持平">方向</th><th title="ok / partial / missing">数据</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="muted">App 收入热度无数据。</td></tr>`}</tbody>
    </table>`)}
    ${fieldNote([
      ["链", "公链:Solana / Base / 以太坊 / BSC。"],
      ["协议", "该链收入 top 协议(pump.fun / GMGN / Aave 等)。"],
      ["24h 收入", "协议 24h <strong>收入</strong>(DeFiLlama revenue)。"],
      ["份额", "该协议占<strong>本链</strong>总收入的比例。"],
      ["动量", "24h 收入 vs 前 7d 日均。>0=升温,<0=降温。"],
      ["方向", "升温 / 降温 / 持平(动量方向,占比<1% 视为持平)。"],
      ["数据", "ok=全源到位 / partial=部分缺 / missing=全缺。"],
    ], "本面板是<strong>活动热度</strong>,不是流动性也不是净流入,不进引擎/conviction;单协议占>60% 会标『谨慎解读为链级热度』。")}
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
      <td class="num ${fundingClass(c.funding)}">${fundingAnnual(c.funding)}</td>
      <td class="num">${ratio(c.perpSpot)}</td>
    </tr>`).join("");
  return `<div class="panel">
    <h2>L4 DEX↔CEX · <span class="${dirClass(x?.direction)}">${esc(DIR_LABEL[x?.direction] ?? x?.direction ?? "—")}</span>${x?.crowding === "high" ? ' <span class="down">合约拥挤</span>' : ""}</h2>
    <div class="how">${esc(HOW.dexCex)}</div>
    <div class="muted">合约/现货量比: ${ratio(x?.perpSpotRatio)} · 数据 ${qBadge(x?.dataQuality)}</div>
    ${tableScroll(`<table>
      <thead><tr><th title="币种(BTC/ETH…)">资产</th><th class="num" title="永续合约资金费率年化;>0=多头付费=资金挤合约(过热),<0=空头付费">资金费率·年化</th><th class="num" title="永续 vs 现货成交量比;偏现货=承接型资金更健康">合约/现货</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">OKX 未采集(可能代理不可达)。</td></tr>`}</tbody>
    </table>`)}
    ${fieldNote([
      ["资产", "币种(BTC / ETH 等主流合约标的)。"],
      ["资金费率·年化", "永续合约 funding 的年化。<span class='warn'>>0</span>=多头付费=资金挤在合约(过热、防挤仓);<span class='up'><0</span>=空头付费。"],
      ["合约/现货", "永续 vs 现货成交量比。偏现货=承接型资金,更健康;偏合约=杠杆投机为主。"],
    ], "本层是<strong>闸门/环境信号,不指导单一标的</strong>;来源 OKX,云端 451 时自动切 Hyperliquid(仅永续腿→标 partial)。")}
  </div>`;
}

// 单条轮动边的推导 + 支持数据(按边类型查各层组件)。
function edgeDerivation(d, e) {
  const pcp = (v) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`);
  if (e.type === "chain") {
    const cc = d.layers?.chain?.components ?? [];
    const at = (chain) => cc.find((c) => c.chain === chain) ?? {};
    const horizon = (c) => `综合 ${esc(c.compositeScore ?? "—")}(6h加速 ${esc(c.accel6h ?? "—")} · 24hDEX ${pcp(c.dexVolChange1dPct)} · 费用 ${esc(c.feesMomentum ?? "—")} · 存量Δ ${esc(c.shareDeltaPp ?? "—")}pp)`;
    const stage = e.stage === "confirmed" ? "已确认(6h+24h 两端同向)" : e.stage === "early" ? "早期(仅 6h 快信号,24h 未确认)" : "—";
    const p = e.persistence;
    return `<div class="sector-deriv"><div><strong>链轮动 ${esc(chainLabel(e.from))}→${esc(chainLabel(e.to))}</strong> — 按综合分选端点(fast6h×0.45 + mid24h×0.35 + slow存量×0.20;非对称阈值 入>+0.10 出<−0.05)。</div>
      <div class="muted">目的地 ${esc(chainLabel(e.to))}:${horizon(at(e.to))}<br/>来源 ${esc(chainLabel(e.from))}:${horizon(at(e.from))}<br/>驱动:${e.flowType === "trading" ? '<span class="up">交易热钱</span>(6h/24h DEX 放量)' : e.flowType === "fee" ? '<span class="warn">费用驱动</span>(交易未放量、靠协议费用)' : "—"}${e.feeSpike ? ` · <span class="warn">⚠ 费用集中于 ${esc(e.feeSpike.protocol ?? "单协议")} ${esc(e.feeSpike.share)}%,已折价 ${esc(Math.round((e.feeSpike.discount ?? 0) * 100))}%</span>` : ""}<br/>分级:${stage};慢钱跟进:${e.slowFollow ? "是" : "否"}${p && p.label && p.label !== "无显著流向" ? `<br/>持续性:流入·${esc(p.label)}·已持续${esc(p.hours ?? 0)}h·动量${esc(momWord(p.momentum))}·广度${esc(p.breadth ?? 0)}/4窗(1h/6h/24h/7d 同向数)` : ""}</div></div>`;
  }
  if (e.type === "sector") {
    const dst = (d.layers?.narrative?.components ?? []).find((c) => c.sector === e.to) ?? {};
    const protos = (dst.topProtocols ?? []).map((x) => `${esc(x.name)} ${esc(usd(x.tvl))}`).join("、") || "—";
    return `<div class="sector-deriv"><div><strong>板块轮动 ${esc(e.from)}→${esc(e.to)}</strong> — 最强(7d ${pcp(e.toChange)})← 最弱(7d ${pcp(e.fromChange)}),强度=两端差值 ${esc(e.strength)};方向按 ±2% 死区。</div>
      <div class="muted">目的地成分(按 TVL):${protos}</div></div>`;
  }
  if (e.type === "launchpad") {
    const lc = d.layers?.launchpad?.components ?? [];
    const src = lc.find((c) => c.launchpad === e.from) ?? {};
    const dst = lc.find((c) => c.launchpad === e.to) ?? {};
    const mom = (v) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${(Number(v) * 100).toFixed(0)}%`);
    return `<div class="sector-deriv"><div><strong>发射台轮动 ${esc(src.label ?? e.from)}→${esc(dst.label ?? e.to)}</strong> — 最热 ${esc(dst.label ?? e.to)}(动量 ${mom(dst.momentum)}·收入 ${esc(usd(dst.revenue24h))}·份额 ${esc(dst.share ?? "—")}%)← 最冷 ${esc(src.label ?? e.from)}(动量 ${mom(src.momentum)})。</div>
      <div class="muted">体量门槛:两端 24h 收入≥$5万 且 份额≥1%(防微量动量鬼边),强度按小端份额缩放。</div></div>`;
  }
  return "";
}

function rotationDerivation(d, edges) {
  if (!edges.length) return "";
  return `<details class="deriv"><summary>推导过程 + 支持数据(点击展开)</summary>
    <div class="deriv-body">
      <div class="muted">轮动地图汇总各层的轮动边:链间(6h/24h/存量 多时间轴综合)· 板块(TVL 7d 相对强弱)· 发射台(收入动量 + 体量门槛)。逐条判定依据与端点数据:</div>
      ${edges.map((e) => edgeDerivation(d, e)).join("")}
    </div>
  </details>`;
}

function rotationPanel(d) {
  const edges = d.flowState?.rotationEdges ?? [];
  const label = (t) => (["solana", "ethereum", "base", "bsc"].includes(t) ? chainLabel(t) : t);
  const body = edges.length
    ? `<ul>${edges.map((e) => `<li class="edge">${esc(label(e.from))} → ${esc(label(e.to))} ${e.type === "chain" ? rotationStageBadge(e) + flowTypeBadge(e) + persistenceBadge(e.persistence) : ""} <span class="muted">(${esc(e.type)}, 强度 ${esc(e.strength)}, ${esc(e.confidence)})</span></li>`).join("")}</ul>${rotationDerivation(d, edges)}`
    : `<p class="muted">暂无显著轮动边。${(d.meta?.historyPoints ?? 0) < 2 ? "(历史点不足,需累积多次采集后才能判断迁移)" : ""}</p>`;
  return `<div class="panel"><h2>轮动地图 · 资金往哪轮</h2>${body}</div>`;
}

const GUIDANCE_METRIC_FIELDS = [
  "priceUsd", "px5mPct", "px1hPct", "px6hPct", "px24hPct", "vol6hUsd", "vol24hUsd",
  "liqUsd", "buys24h", "sells24h", "fdvUsd", "marketCapUsd", "ca", "source", "at",
];
const GUIDANCE_METRIC_LABELS = {
  priceUsd: "价格", px5mPct: "5m", px1hPct: "1h", px6hPct: "6h", px24hPct: "24h",
  vol6hUsd: "6h 成交", vol24hUsd: "24h 成交", liqUsd: "流动性", buys24h: "24h 买入",
  sells24h: "24h 卖出", fdvUsd: "FDV", marketCapUsd: "市值", ca: "合约地址", source: "来源", at: "时间",
};

function guidanceMetricValue(key, value) {
  if (value === null || value === undefined) return "—";
  if (key.startsWith("px")) return pctSigned(Number(value));
  if (key === "priceUsd") return price(value);
  if (["vol6hUsd", "vol24hUsd", "liqUsd", "fdvUsd", "marketCapUsd"].includes(key)) return usd(value);
  if (["buys24h", "sells24h"].includes(key)) return countCn(value);
  if (key === "ca") return shortCa(value);
  if (key === "at") return relTime(value);
  return String(value);
}

function guidanceContractRow(metrics, chainTag) {
  const ca = metrics?.ca;
  if (typeof ca !== "string" || ca.length === 0) {
    return `<div class="contract-row"><span>合约地址</span><strong class="muted">—（该源无合约地址）</strong></div>`;
  }
  const gmgn = gmgnUrl(chainTag, ca);
  const gmgnLink = gmgn ? `<a class="ext-link" href="${esc(gmgn)}" target="_blank" rel="noopener noreferrer">GMGN ↗</a>` : "";
  return `<div class="contract-row"><span>合约地址</span><strong class="ca-value" title="${esc(ca)}">${esc(shortCa(ca))}</strong><button class="copy-btn" type="button" data-ca="${esc(ca)}" title="复制完整合约地址">复制</button>${gmgnLink}</div>`;
}

function guidanceMetricRows(metrics) {
  const keys = metrics && typeof metrics === "object"
    ? [...new Set([...GUIDANCE_METRIC_FIELDS, ...Object.keys(metrics)])]
    : GUIDANCE_METRIC_FIELDS;
  return keys.map((key) => `<div class="metric-item"><span>${esc(GUIDANCE_METRIC_LABELS[key] ?? key)}</span><strong>${esc(guidanceMetricValue(key, metrics?.[key]))}</strong></div>`).join("");
}

function guidanceFactorRows(factors) {
  if (!Array.isArray(factors) || factors.length === 0) return `<div class="muted">因子明细缺失。</div>`;
  return factors.map((factor) => `<div class="factor-item">
    <div><strong>${esc(factor.label ?? factor.key)}</strong><span class="muted"> ${esc(factor.key)}</span></div>
    <div>${esc(factor.detail ?? "—")}</div>
    <div class="num ${Number(factor.pts) > 0 ? "up" : Number(factor.pts) < 0 ? "down" : "flat"}">${Number.isFinite(Number(factor.pts)) ? `${Number(factor.pts) > 0 ? "+" : ""}${Number(factor.pts).toFixed(1)} 点` : "—"}</div>
  </div>`).join("");
}

function guidanceDetailRow(g, index) {
  return `<tr class="detail-row" data-guidance-detail="${index}" style="display:none">
    <td colspan="9">
      <div class="guidance-detail">
        <div>
          <h3>标的级 metrics</h3>
          ${guidanceContractRow(g.metrics, g.chainTag)}
          <div class="metric-grid">${guidanceMetricRows(g.metrics)}</div>
        </div>
        <div>
          <h3>conviction 因子</h3>
          <div class="factor-list">${guidanceFactorRows(g.factors)}</div>
        </div>
        <div>
          <h3>顺风 / 逆风层</h3>
          <div>顺风:${(g.tailwindLayers ?? []).length ? g.tailwindLayers.map((t) => `<span class="up">${esc(t.layer)}${t.reason ? `(${esc(t.reason)})` : ""}</span>`).join("、") : "—"}</div>
          <div style="margin-top:4px">逆风:${(g.headwindLayers ?? []).length ? g.headwindLayers.map((h) => `<span class="down">${esc(h.layer)}${h.reason ? `(${esc(h.reason)})` : ""}</span>`).join("、") : "—"}</div>
        </div>
        <div>
          <h3>风险标记${(g.riskFlags ?? []).length ? ` <span class="down">${esc(g.riskFlags.length)}</span>` : ""}</h3>
          ${(g.riskFlags ?? []).length ? `<ul class="risk-list">${g.riskFlags.map((r) => `<li class="down">${esc(r)}</li>`).join("")}</ul>` : `<div class="muted">无</div>`}
        </div>
        <div class="muted gap-note">持币人数/分时净流入：免费云端无源，标缺口（可本地 GMGN 补）。</div>
      </div>
    </td>
  </tr>`;
}

function guidancePanel(d) {
  const rows = (d.guidance ?? []).map((g, index) => `<tr class="guidance-main-row" data-guidance-index="${index}">
    <td><button class="guidance-toggle" type="button" data-guidance-index="${index}" aria-expanded="false" aria-label="展开 ${esc(g.target)} 明细">+</button></td>
    <td><span class="target-cell"><span>${esc(g.target)}</span>${chainChip(g.chainTag)}</span></td>
    <td class="muted">${g.type === "cex_perp" ? "CEX合约" : "链上现货"}</td>
    <td class="num tier-text-${esc(g.tier)}">${esc(g.conviction)}</td>
    <td><span class="tier tier-${esc(g.tier)}">${esc(g.tierLabel ?? g.tier)}</span></td>
    <td class="tags hide-mobile">${(g.tailwindLayers ?? []).map((t) => esc(t.layer)).join("/") || "—"}</td>
    <td class="tags hide-mobile">${(g.headwindLayers ?? []).map((h) => esc(h.layer)).join("/") || "—"}</td>
    <td class="tags ${g.riskFlags?.length ? "down" : "muted"}">${(g.riskFlags ?? []).map(esc).join("；") || "—"}</td>
    <td>${qBadge(g.dataQuality)}</td>
  </tr>${guidanceDetailRow(g, index)}`).join("");
  return `<div class="panel">
    <h2>标的仓位建议(辅助 · 不下单)</h2>
    <div class="how">${esc(HOW.guidance)}</div>
    ${tableScroll(`<table class="guidance-table">
      <thead><tr><th title="点 + 展开该标的详情(metrics/因子/顺风逆风/风险全文/CA)"></th><th title="币种(动态 watchlist,GeckoTerminal 各链热门)">标的</th><th title="建议参与场所:链上现货 / CEX 合约">类型</th><th class="num" title="信念分:各层方向×强度×置信度(0.6)+标的因子(0.4)加权,越高越该关注">conviction</th><th title="建议仓位档;watch_only 为硬上限,绝不下单">仓位档</th><th class="hide-mobile" title="支持该标的的层(利多)">顺风</th><th class="hide-mobile" title="反对该标的的层(利空)">逆风</th><th title="风险标记,每条降一档;移动端看数量,详情行看全文">风险</th><th title="ok / partial / missing">数据</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="muted">未配置标的清单。</td></tr>`}</tbody>
    </table>`)}
    ${fieldNote([
      ["+ (首列)", "点开该标的<strong>详情行</strong>:标的级 metrics(价格/多窗涨幅/量/流动性/买卖/CA 复制)+ conviction 因子 + 顺风/逆风全文 + 风险全文。"],
      ["标的", "币种(动态 watchlist,来自 GeckoTerminal 各链热门 top);带所在链标。"],
      ["类型", "建议参与场所:链上现货 / CEX 合约。"],
      ["conviction", "信念分:各层方向×强度×置信度(占 0.6)+ 标的因子(占 0.4:多窗动量/买卖不平衡/换手)加权。<strong>越高越该关注</strong>,不是价格预测。"],
      ["仓位档", "建议仓位档(如 试探 / 空仓)。<strong>watch_only 为硬上限,系统绝不下单</strong>;宏观收水时封顶到试探。"],
      ["顺风", "支持该标的的层(利多),如 chain(该链净流入)。<strong>移动端在详情行看全</strong>。"],
      ["逆风", "反对该标的的层(利空)。移动端在详情行看全。"],
      ["风险", "风险标记(如 流动性薄、换手异常),<strong>每条降一档</strong>。移动端列内只显数量,详情行看全文。"],
      ["数据", "ok=全源到位 / partial=部分缺 / missing=全缺。"],
    ], "全表为<strong>决策辅助,不构成下单指令</strong>;真实交易由你手动执行。")}
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
