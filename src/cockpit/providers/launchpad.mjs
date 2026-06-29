// L3 provider — DeFiLlama fees overview (free API endpoint, not the 403 frontend).
import { normalizeLaunchpadFees } from "../layers/launchpad.mjs";

export const LAUNCHPAD_FEES_URL =
  "https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue";

export async function loadLaunchpadFeesSnapshot({ fetchImpl = fetch, url = LAUNCHPAD_FEES_URL } = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`launchpad fees HTTP ${response.status}`);
  }
  const raw = await response.json();
  const { perLaunchpad } = normalizeLaunchpadFees(raw);
  return { source: "defillama-launchpad-fees", perLaunchpad };
}
