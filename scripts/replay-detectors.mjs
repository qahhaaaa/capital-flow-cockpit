// Detector replay over the accumulated rolling history (public/data/cockpit-history.json).
// Compares, per chain, the legacy adjacent-point direction detector against the
// time-anchored detector + CUSUM inflection alarms — using the PRODUCTION functions
// (anchoredDeltas / cusum / resampleByTime), not a re-implementation.
// Analysis tooling only: read-only, not part of collection or CI.
// Usage: node scripts/replay-detectors.mjs
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildShareSeriesWithTs, buildTideSeries } from "../src/cockpit/history.mjs";
import { anchoredDeltas } from "../src/cockpit/layers/chain-flow.mjs";
import { cusum, resampleByTime } from "../src/cockpit/stats.mjs";

const FLAT_EPS_PP = 0.02; // keep in sync with chain-flow.mjs
const STEP_MS = 4 * 60 * 60 * 1000;

const dirOf = (delta) => (delta > FLAT_EPS_PP ? "in" : delta < -FLAT_EPS_PP ? "out" : "flat");
const flips = (dirs) => dirs.filter((d, i) => i > 0 && d !== dirs[i - 1]).length;

// Walk growing prefixes and record where the production cusum() starts reporting an alarm.
function alarmTimeline(values, firstTs) {
  const events = [];
  let previous = null;
  for (let i = 9; i <= values.length; i += 1) {
    const { alarm } = cusum(values.slice(0, i));
    if (alarm && alarm !== previous) {
      events.push({ alarm, at: new Date(firstTs + (i - 1) * STEP_MS).toISOString().slice(0, 16) });
    }
    previous = alarm;
  }
  return events;
}

const history = JSON.parse(await readFile(resolve("public/data/cockpit-history.json"), "utf8"));
const spanH = (Date.parse(history.at(-1).ts) - Date.parse(history[0].ts)) / 3600e3;
console.log(`history: ${history.length} points, ${spanH.toFixed(1)}h span (${history[0].ts} → ${history.at(-1).ts})`);
console.log("note: 现有历史为 4h 间隔 → 锚定 delta 与相邻差分应几乎一致(平滑迁移的预期);");
console.log("      1h 采集开始后两者才分化。CUSUM 警报是新增信息:每步都在死区内的慢漂移。\n");

for (const entry of buildShareSeriesWithTs(history)) {
  const shares = entry.sharePoints.map((p) => Number(p.share));
  const legacyDirs = shares.slice(1).map((v, i) => dirOf(v - shares[i]));
  const { deltas } = anchoredDeltas(entry.sharePoints);
  const anchoredDirs = deltas.map(dirOf);
  const resampled = resampleByTime(entry.sharePoints, { stepMs: STEP_MS, value: (p) => p.share, ts: (p) => p.ts });
  const alarms = alarmTimeline(resampled, Date.parse(entry.sharePoints[0].ts));
  console.log(
    `${entry.label.padEnd(8)} 方向翻转 legacy=${flips(legacyDirs)} anchored=${flips(anchoredDirs)}` +
      ` | 最新方向 legacy=${legacyDirs.at(-1) ?? "—"} anchored=${anchoredDirs.at(-1) ?? "—"}` +
      ` | CUSUM 警报: ${alarms.length ? alarms.map((e) => `${e.alarm}@${e.at}`).join(", ") : "无"}`,
  );
}

const tide = buildTideSeries(history);
console.log(`\ntide series: ${tide.length} points(totalUsd 字段自本次改动起才写入;历史旧点无此字段=诚实缺失,从现在积累)`);
