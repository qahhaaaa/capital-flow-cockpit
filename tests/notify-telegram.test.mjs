import test from "node:test";
import assert from "node:assert/strict";

import { diffCockpitState, buildTelegramMessage, notifyTelegram } from "../scripts/notify-telegram.mjs";

const snapshot = (over = {}) => ({
  regime: "neutral",
  moneyLocation: "分散/无明显集中",
  meta: { generatedAt: "2026-07-03T00:00:00.000Z" },
  guidance: [{ target: "WIF", tier: "probe", tierLabel: "试探" }],
  flowState: { rotationEdges: [] },
  dataHealth: { layers: [{ layer: "chain", dataQuality: "ok" }] },
  ...over,
});

test("diffCockpitState: identical snapshots produce no change lines", () => {
  assert.deepEqual(diffCockpitState(snapshot(), snapshot()), []);
});

test("diffCockpitState: null prev is a baseline push, not silence", () => {
  const lines = diffCockpitState(null, snapshot());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /首次基线/);
});

test("diffCockpitState: regime flip, tier change, edge appearance and quality drop are all reported", () => {
  const prev = snapshot();
  const next = snapshot({
    regime: "risk_off",
    guidance: [{ target: "WIF", tier: "flat", tierLabel: "空仓" }],
    flowState: { rotationEdges: [{ from: "ethereum", to: "solana", type: "chain" }] },
    dataHealth: { layers: [{ layer: "chain", dataQuality: "partial" }] },
  });
  const lines = diffCockpitState(prev, next);
  assert.ok(lines.some((l) => l.includes("中性 → 收水")));
  assert.ok(lines.some((l) => l.includes("WIF 仓位档: 试探 → 空仓")));
  assert.ok(lines.some((l) => l.includes("轮动边出现: ethereum→solana(chain)")));
  assert.ok(lines.some((l) => l.includes("数据质量 chain: ok → partial")));
});

test("diffCockpitState: stableTide direction flip is reported once both sides carry it", () => {
  const prev = snapshot({ stableTide: { direction: "inflow" } });
  const next = snapshot({ stableTide: { direction: "outflow" } });
  const lines = diffCockpitState(prev, next);
  assert.ok(lines.some((l) => l.includes("稳定币总量潮汐: inflow → outflow")));
  // one side missing the field (older snapshot) -> silent, no false alarm
  assert.deepEqual(diffCockpitState(snapshot(), next), []);
});

test("buildTelegramMessage escapes HTML in dynamic content and links the panel", () => {
  const msg = buildTelegramMessage(["宏观水位: 放水 → 收水", "risky <b>bold</b>"], snapshot(), "https://example.test/panel/");
  assert.ok(msg.includes("risky &lt;b&gt;bold&lt;/b&gt;"));
  assert.ok(msg.includes('href="https://example.test/panel/"'));
  assert.ok(msg.includes("2026-07-03T00:00:00.000Z"));
});

test("buildTelegramMessage truncates unusually wide diffs below Telegram's message cap", () => {
  const diffs = Array.from({ length: 30 }, (_, i) => `变化 ${i + 1}`);
  const msg = buildTelegramMessage(diffs, snapshot());
  assert.ok(msg.includes("变化 20"));
  assert.ok(!msg.includes("变化 21"));
  assert.ok(msg.includes("另外 10 项变化"));
});

test("diffCockpitState tolerates malformed snapshot shapes instead of throwing", () => {
  const broken = snapshot({ guidance: { not: "an-array" }, flowState: { rotationEdges: "junk" }, dataHealth: {} });
  assert.doesNotThrow(() => diffCockpitState(broken, snapshot()));
  assert.doesNotThrow(() => diffCockpitState(snapshot(), broken));
});

test("notifyTelegram skips silently without secrets and never touches the network", async () => {
  let fetched = 0;
  const result = await notifyTelegram({
    prevPath: "no-such-prev.json",
    nextPath: "no-such-next.json",
    env: {},
    fetchImpl: async () => { fetched += 1; return { ok: true }; },
    log: () => {},
    warn: () => {},
  });
  assert.deepEqual(result, { sent: false, reason: "no-secrets" });
  assert.equal(fetched, 0);
});
