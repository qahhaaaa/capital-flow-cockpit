// L5 provider — DeFiLlama /protocols (free API), aggregated into category TVL/momentum.
import { normalizeCategories } from "../layers/narrative.mjs";

export const PROTOCOLS_URL = "https://api.llama.fi/protocols";

export async function loadCategoriesSnapshot({ fetchImpl = fetch, url = PROTOCOLS_URL } = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`protocols HTTP ${response.status}`);
  }
  const raw = await response.json();
  const { perSector } = normalizeCategories(raw);
  return { source: "defillama-categories", perSector };
}
