// Cockpit v2 collector (tracer-bullet: Layer 2 chain flow live end-to-end).
// Real fetch -> normalize -> rolling history -> chain-flow signal -> v2 contract -> cockpit.json.
// Source failure is isolated: the layer is marked missing and the snapshot still writes.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assembleCockpit } from "../src/cockpit/contract.mjs";
import { appendCockpitHistory, buildHistoryEntry, buildShareSeries } from "../src/cockpit/history.mjs";
import { computeChainFlowSignal } from "../src/cockpit/layers/chain-flow.mjs";
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
    history = appendCockpitHistory(history, buildHistoryEntry({ ts: now, perChain: snapshot.perChain }));
    sourceStatus.push({ source: "defillama-stablecoinchains", status: "ok" });
  } catch (error) {
    sourceStatus.push({ source: "defillama-stablecoinchains", status: "error", message: error.message });
  }

  layerSignals.chain = computeChainFlowSignal(buildShareSeries(history));

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

  try {
    const dexCex = await loadDexCex();
    layerSignals.dexCex = computeDexCexSignal(dexCex);
    sourceStatus.push({ source: "okx-derivatives", status: "ok" });
  } catch (error) {
    layerSignals.dexCex = computeDexCexSignal({ assets: [] });
    sourceStatus.push({ source: "okx-derivatives", status: "error", message: error.message });
  }

  const cockpit = assembleCockpit({
    layerSignals,
    watchlist,
    meta: { generatedAt: now, historyPoints: history.length },
    sourceStatus,
    appRevenueHeat,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  await writeFile(outputPath, `${JSON.stringify(cockpit, null, 2)}\n`, "utf8");
  return { cockpit, outputPath };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  collectCockpit()
    .then(({ outputPath: path }) => console.log(`Wrote ${path}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
