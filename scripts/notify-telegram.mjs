// Telegram state-change notifier for the cockpit.
// Design (see docs/project-handover.md §11 + workflow comments):
//  - Push ONLY on state change: compare the previous committed cockpit.json (git show HEAD:...)
//    against the freshly collected one; no change -> no message (no spam).
//  - Zero hard dependency: secrets absent -> silently skip (exit 0); send failure -> warn, exit 0.
//    The notifier must NEVER fail the collect/deploy workflow (same isolation discipline as providers).
//  - The bot token is read from env and never printed/logged; error output is token-free.
// Usage: node scripts/notify-telegram.mjs <prev-cockpit.json> <next-cockpit.json>
//   env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (both required to send),
//        TELEGRAM_FORCE=1 (send even without diffs; for baseline/manual test),
//        PAGES_URL (panel link override).
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_PAGES_URL = "https://qahhaaaa.github.io/capital-flow-cockpit/";

const REGIME_LABEL = { risk_on: "放水", risk_off: "收水", neutral: "中性", unknown: "未知" };
const QUALITY_LABEL = { ok: "ok", partial: "partial", missing: "missing" };

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const edgeKey = (e) => `${e?.from}→${e?.to}(${e?.type})`;
const tierText = (row) => row?.tierLabel ?? row?.tier ?? "—";

// Pure: previous vs next cockpit snapshot -> list of human-readable change lines (zh).
// prev === null (first run / no committed snapshot yet) counts as a change: baseline push.
export function diffCockpitState(prev, next) {
  if (!next) return [];
  if (!prev) return ["📌 首次基线推送(此前无已提交状态)"];
  const lines = [];

  const prevRegime = prev.regime ?? "unknown";
  const nextRegime = next.regime ?? "unknown";
  if (prevRegime !== nextRegime) {
    lines.push(`宏观水位: ${REGIME_LABEL[prevRegime] ?? prevRegime} → ${REGIME_LABEL[nextRegime] ?? nextRegime}`);
  }

  if ((prev.moneyLocation ?? "") !== (next.moneyLocation ?? "")) {
    lines.push(`钱主要在: ${prev.moneyLocation ?? "—"} → ${next.moneyLocation ?? "—"}`);
  }

  // Position tiers per watchlist target. Array.isArray (not ?? []) throughout: a snapshot
  // from an older/newer schema may carry these keys with a non-array shape, and a diff
  // crash here would sink the whole collection run (this step runs before the data commit).
  const rows = (value) => (Array.isArray(value) ? value : []);
  // 动态 watchlist 每小时轮换成员/重排名次——两者都不构成推送触发(否则每小时刷屏);
  // 只有"两边都存在的标的"发生档位变化才是真状态变化。成员增减仅在存在其它真实
  // 变化时,以一行汇总附带说明。
  const prevRows = new Map(rows(prev.guidance).map((row) => [row.target, row]));
  let added = 0;
  for (const row of rows(next.guidance)) {
    const before = prevRows.get(row.target);
    if (!before) {
      added += 1;
      continue;
    }
    if (before.tier !== row.tier) {
      lines.push(`${row.target} 仓位档: ${tierText(before)} → ${tierText(row)}`);
    }
    prevRows.delete(row.target);
  }
  const removed = prevRows.size;

  // Rotation edges appear/disappear.
  const prevEdges = new Set(rows(prev.flowState?.rotationEdges).map(edgeKey));
  const nextEdges = new Set(rows(next.flowState?.rotationEdges).map(edgeKey));
  for (const key of nextEdges) if (!prevEdges.has(key)) lines.push(`轮动边出现: ${key}`);
  for (const key of prevEdges) if (!nextEdges.has(key)) lines.push(`轮动边消失: ${key}`);

  // Layer data-quality transitions (source health degradation/recovery).
  const prevQ = new Map(rows(prev.dataHealth?.layers).map((l) => [l.layer, l.dataQuality]));
  for (const layer of rows(next.dataHealth?.layers)) {
    const before = prevQ.get(layer.layer);
    if (before !== undefined && before !== layer.dataQuality) {
      lines.push(`数据质量 ${layer.layer}: ${QUALITY_LABEL[before] ?? before} → ${QUALITY_LABEL[layer.dataQuality] ?? layer.dataQuality}`);
    }
  }

  // Stablecoin total tide direction flip (side-channel; present from sensitivity package on).
  const prevTide = prev.stableTide?.direction;
  const nextTide = next.stableTide?.direction;
  if (prevTide && nextTide && prevTide !== nextTide) {
    lines.push(`稳定币总量潮汐: ${prevTide} → ${nextTide}`);
  }

  // Membership churn is context, never a trigger: appended only when real changes exist.
  if ((added > 0 || removed > 0) && lines.length > 0) {
    lines.push(`标的轮换: +${added}/-${removed}`);
  }

  return lines;
}

// Telegram hard-caps messages at 4096 chars; keep well under it so an unusually wide diff
// (e.g. first run after a schema change) cannot 400 the send.
const MAX_LINES = 20;

// Pure: change lines + snapshot -> Telegram HTML message (dynamic parts escaped).
export function buildTelegramMessage(diffs, next, pagesUrl = DEFAULT_PAGES_URL) {
  const shown = diffs.slice(0, MAX_LINES);
  if (diffs.length > shown.length) shown.push(`……以及另外 ${diffs.length - shown.length} 项变化(见面板)`);
  const body = shown.map((line) => `• ${esc(line)}`).join("\n");
  const regime = REGIME_LABEL[next?.regime ?? "unknown"] ?? next?.regime ?? "—";
  const ts = next?.meta?.generatedAt ?? "—";
  return [
    "<b>🛰 资金流驾驶舱 · 状态变化</b>",
    body,
    `当前: ${esc(regime)} · ${esc(next?.moneyLocation ?? "—")}`,
    `<a href="${esc(pagesUrl)}">打开面板</a> · <code>${esc(ts)}</code>`,
  ].join("\n");
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function notifyTelegram({
  prevPath,
  nextPath,
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  warn = console.warn,
} = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log("telegram: skipped (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured)");
    return { sent: false, reason: "no-secrets" };
  }

  const next = await readJsonOrNull(nextPath);
  if (!next) {
    warn("telegram: next snapshot unreadable, nothing to send");
    return { sent: false, reason: "no-next" };
  }
  const prev = await readJsonOrNull(prevPath);

  const diffs = diffCockpitState(prev, next);
  if (diffs.length === 0 && env.TELEGRAM_FORCE !== "1") {
    log("telegram: no state change, nothing to send");
    return { sent: false, reason: "no-change" };
  }
  const lines = diffs.length ? diffs : ["(手动触发,无状态变化)"];
  const text = buildTelegramMessage(lines, next, env.PAGES_URL || DEFAULT_PAGES_URL);

  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      // Telegram error bodies do not contain the token; safe to log a short slice.
      const detail = (await response.text()).slice(0, 200);
      warn(`telegram: send failed HTTP ${response.status}: ${detail}`);
      return { sent: false, reason: `http-${response.status}` };
    }
    log(`telegram: sent (${lines.length} change line(s))`);
    return { sent: true, changes: lines.length };
  } catch (error) {
    warn(`telegram: send failed: ${error.message}`); // network-level message, token-free
    return { sent: false, reason: "network" };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [prevPath, nextPath] = process.argv.slice(2);
  if (!nextPath) {
    console.error("usage: node scripts/notify-telegram.mjs <prev-cockpit.json> <next-cockpit.json>");
    process.exitCode = 1;
  } else {
    // Never fail the workflow: skip/no-change/send-failure resolve normally, and even an
    // unexpected throw (e.g. a snapshot shape this diff never anticipated) only warns —
    // this step runs BEFORE the data commit, so a crash here would sink the whole run.
    await notifyTelegram({ prevPath, nextPath }).catch((error) => {
      console.warn(`telegram: unexpected error, skipped: ${error.message}`);
    });
  }
}
