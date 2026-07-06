// Cockpit v2 collector (tracer-bullet: Layer 2 chain flow live end-to-end).
// Real fetch -> normalize -> rolling history -> chain-flow signal -> v2 contract -> cockpit.json.
// Source failure is isolated: the layer is marked missing and the snapshot still writes.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assembleCockpit } from "../src/cockpit/contract.mjs";
import { appendCockpitHistory, buildChainScoreSeries, buildHistoryEntry, buildShareSeriesWithTs, buildTideSeries } from "../src/cockpit/history.mjs";
import { computeChainFlowSignal, computeChainPersistence } from "../src/cockpit/layers/chain-flow.mjs";
import { computeStableTideSignal } from "../src/cockpit/layers/stable-tide.mjs";
import { computeAppRevenueSignal } from "../src/cockpit/layers/app-revenue.mjs";
import { computeLaunchpadSignal } from "../src/cockpit/layers/launchpad.mjs";
import { computeMacroSignal } from "../src/cockpit/layers/macro.mjs";
import { computeNarrativeSignal } from "../src/cockpit/layers/narrative.mjs";
import { computeDexCexSignal } from "../src/cockpit/layers/dexcex.mjs";
import { loadStablecoinChainsSnapshot } from "../src/cockpit/providers/stablecoins.mjs";
import { loadAppRevenueSnapshot } from "../src/cockpit/providers/app-revenue.mjs";
import { loadLaunchpadFeesSnapshot } from "../src/cockpit/providers/launchpad.mjs";
import { loadFredNetLiquiditySnapshot } from "../src/cockpit/providers/macro.mjs";
import { loadCategoriesSnapshot } from "../src/cockpit/providers/narrative.mjs";
import { loadMindshareSnapshot } from "../src/cockpit/providers/mindshare.mjs";
import { loadOkxDerivativesSnapshot } from "../src/cockpit/providers/dexcex.mjs";
import { loadHyperliquidDerivativesSnapshot } from "../src/cockpit/providers/hyperliquid.mjs";
import { loadDynamicWatchlist } from "../src/cockpit/providers/watchlist.mjs";
import { loadChainDexVolumeSnapshot } from "../src/cockpit/providers/chain-volume.mjs";

const outputPath = resolve("public/data/cockpit.json");
const historyPath = resolve("public/data/cockpit-history.json");

// Placeholder watchlist until a user-config seam is added; demonstrates guidance shape.
const DEFAULT_WATCHLIST = [
  { target: "WIF", type: "onchain_spot", chainTag: "solana", launchpadTag: "pumpfun" },
  { target: "AERO", type: "onchain_spot", chainTag: "base" },
  { target: "BNB-PERP", type: "cex_perp", chainTag: "bsc" },
];

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function collectCockpit({
  load = loadStablecoinChainsSnapshot,
  loadAppRevenue = loadAppRevenueSnapshot,
  loadLaunchpad = loadLaunchpadFeesSnapshot,
  loadMacro = loadFredNetLiquiditySnapshot,
  loadNarrative = loadCategoriesSnapshot,
  loadMindshare = loadMindshareSnapshot,
  loadDexCex = loadOkxDerivativesSnapshot,
  loadDexCexFallback = loadHyperliquidDerivativesSnapshot,
  loadWatchlist = loadDynamicWatchlist,
  loadChainVolume = loadChainDexVolumeSnapshot,
  watchlist = DEFAULT_WATCHLIST,
  now = new Date().toISOString(),
} = {}) {
  const sourceStatus = [];
  const layerSignals = {};
  let appRevenueHeat = null;
  let history = await readJson(historyPath, []);

  try {
    const macro = await loadMacro();
    layerSignals.macro = computeMacroSignal(macro.series);
    sourceStatus.push({ source: "fred-net-liquidity", status: "ok" });
  } catch (error) {
    layerSignals.macro = computeMacroSignal([]);
    sourceStatus.push({ source: "fred-net-liquidity", status: "error", message: error.message });
  }

  try {
    const snapshot = await load();
    history = appendCockpitHistory(
      history,
      buildHistoryEntry({ ts: now, perChain: snapshot.perChain, totalUsd: snapshot.totalUsd }),
    );
    sourceStatus.push({ source: "defillama-stablecoinchains", status: "ok" });
  } catch (error) {
    sourceStatus.push({ source: "defillama-stablecoinchains", status: "error", message: error.message });
  }

  // Tide reads from whatever history holds, so a failed fetch this run degrades, never zeroes.
  // (chain signal computed further down, after DEX-volume + chain-fees components are loaded)
  const stableTide = computeStableTideSignal(buildTideSeries(history));

  // 动态标的:GT trending 每链 top3;单链失败沿用上一快照该链标的(metrics 置 null),
  // 全部失败且无旧快照才退回占位 DEFAULT_WATCHLIST。成员轮换不触发 TG 推送(notify 已防噪)。
  let activeWatchlist = watchlist;
  let chainActivity; // GT 链级 6h/1h 快信号(链间综合的 fast 层);失败→undefined 自动降级
  try {
    const dyn = await loadWatchlist();
    chainActivity = dyn.chainActivity;
    const prevSnapshot = await readJson(outputPath, null);
    const prevRows = Array.isArray(prevSnapshot?.guidance) ? prevSnapshot.guidance : [];
    const entries = [];
    for (const [chainId, fresh] of Object.entries(dyn.perChain)) {
      if (fresh.length) {
        entries.push(...fresh);
        continue;
      }
      for (const row of prevRows.filter((r) => r.chainTag === chainId).slice(0, 3)) {
        entries.push({ target: row.target, type: row.type ?? "onchain_spot", chainTag: chainId, launchpadTag: null, metrics: null });
      }
    }
    if (entries.length) activeWatchlist = entries;
    sourceStatus.push({
      source: "geckoterminal-trending",
      status: dyn.errors.length === 0 ? "ok" : entries.length ? "partial" : "error",
      ...(dyn.errors.length ? { message: dyn.errors.map((e) => `${e.chain}: ${e.message}`).join("; ").slice(0, 200) } : {}),
    });
  } catch (error) {
    sourceStatus.push({ source: "geckoterminal-trending", status: "error", message: error.message });
  }

  try {
    const launchpad = await loadLaunchpad();
    layerSignals.launchpad = computeLaunchpadSignal(launchpad.perLaunchpad);
    sourceStatus.push({ source: "defillama-launchpad-fees", status: "ok" });
  } catch (error) {
    layerSignals.launchpad = computeLaunchpadSignal([]);
    sourceStatus.push({ source: "defillama-launchpad-fees", status: "error", message: error.message });
  }

  try {
    const appRevenue = await loadAppRevenue();
    appRevenueHeat = computeAppRevenueSignal(appRevenue.perChainApps);
    sourceStatus.push({
      source: "defillama-chain-fees",
      status: appRevenueHeat.dataQuality,
      ...(appRevenue.errors?.length
        ? { message: appRevenue.errors.map((e) => `${e.chain}: ${e.message}`).join("; ") }
        : {}),
    });
  } catch (error) {
    appRevenueHeat = computeAppRevenueSignal([]);
    sourceStatus.push({ source: "defillama-chain-fees", status: "error", message: error.message });
  }

  // 每链 DEX 量动量(链间信号第二组件);失败→undefined,链信号只用份额+费用并自动归一。
  let dexVolume;
  try {
    const dv = await loadChainVolume();
    dexVolume = dv.perChain;
    sourceStatus.push({
      source: "defillama-dexs",
      status: dv.errors.length ? "partial" : "ok",
      ...(dv.errors.length ? { message: dv.errors.map((e) => `${e.chain}: ${e.message}`).join("; ").slice(0, 200) } : {}),
    });
  } catch (error) {
    sourceStatus.push({ source: "defillama-dexs", status: "error", message: error.message });
  }

  // 链间信号:多时间轴综合 fast(6h,GT)/mid(24h,DeFiLlama)/slow(存量) = 0.45/0.35/0.20,
  // 缺失层归一化;轮动边按综合分选端点、分早期/确认两级。
  layerSignals.chain = computeChainFlowSignal(buildShareSeriesWithTs(history), {
    dexVolume,
    chainFees: appRevenueHeat?.byChain,
    chainActivity,
  });

  // P-C 持续性:把本次各链综合分写回当前历史点,用积累的分数序列算持续性签名(仅往后积累,起初标"积累中")。
  const chainComponents = layerSignals.chain.components ?? [];
  const chainScores = {};
  for (const component of chainComponents) {
    if (typeof component.compositeScore === "number" && Number.isFinite(component.compositeScore)) {
      chainScores[component.chain] = component.compositeScore;
    }
  }
  const lastEntry = history.at(-1);
  if (lastEntry && lastEntry.ts === now && Object.keys(chainScores).length) lastEntry.chainScores = chainScores;
  const scoreSeriesByChain = new Map(buildChainScoreSeries(history).map((s) => [s.chain, s.scorePoints]));
  const dexVol7dByChain = new Map((Array.isArray(dexVolume) ? dexVolume : []).map((row) => [row.chain, row.dexVolChange7dPct]));
  for (const component of chainComponents) {
    component.persistence = computeChainPersistence(component, scoreSeriesByChain.get(component.chain), {
      dexVolChange7dPct: dexVol7dByChain.get(component.chain),
    });
  }
  // 每条轮动边的持续性 = 目的地链(钱流入端)的持续性签名
  for (const edge of layerSignals.chain.rotationEdges ?? []) {
    const dest = chainComponents.find((component) => component.chain === edge.to);
    if (dest) edge.persistence = dest.persistence;
  }

  let mindshare = null;
  try {
    const ms = await loadMindshare();
    mindshare = { trendingCoins: ms.trendingCoins, trendingCategories: ms.trendingCategories };
    sourceStatus.push({ source: "coingecko-trending", status: "ok" });
  } catch (error) {
    sourceStatus.push({ source: "coingecko-trending", status: "error", message: error.message });
  }

  try {
    const narrative = await loadNarrative();
    layerSignals.narrative = computeNarrativeSignal(narrative.perSector, { mindshare });
    sourceStatus.push({ source: "defillama-categories", status: "ok" });
  } catch (error) {
    layerSignals.narrative = computeNarrativeSignal([], { mindshare });
    sourceStatus.push({ source: "defillama-categories", status: "error", message: error.message });
  }

  // L4 primary/backup chain: OKX first (richer: real spot leg -> perp/spot ratio), then
  // Hyperliquid (key-free, not US-blocked -> works on GitHub-hosted runners where OKX 451s;
  // no spot leg -> layer degrades to partial, never fabricated). Both failing -> missing.
  try {
    const dexCex = await loadDexCex();
    layerSignals.dexCex = computeDexCexSignal(dexCex);
    sourceStatus.push({ source: "okx-derivatives", status: "ok" });
  } catch (error) {
    sourceStatus.push({ source: "okx-derivatives", status: "error", message: error.message });
    try {
      const fallback = await loadDexCexFallback();
      layerSignals.dexCex = computeDexCexSignal(fallback);
      sourceStatus.push({ source: "hyperliquid-derivatives", status: "ok" });
    } catch (fallbackError) {
      layerSignals.dexCex = computeDexCexSignal({ assets: [] });
      sourceStatus.push({ source: "hyperliquid-derivatives", status: "error", message: fallbackError.message });
    }
  }

  const cockpit = assembleCockpit({
    layerSignals,
    watchlist: activeWatchlist,
    meta: { generatedAt: now, historyPoints: history.length },
    sourceStatus,
    appRevenueHeat,
    stableTide,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  await writeFile(outputPath, `${JSON.stringify(cockpit, null, 2)}\n`, "utf8");
  return { cockpit, outputPath };
}

// argv[1] guard: importing this module from `node -e` / REPL leaves argv[1] undefined,
// and pathToFileURL(undefined) throws — an import side-effect crash, not a CLI run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  collectCockpit()
    .then(({ outputPath: path }) => console.log(`Wrote ${path}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
