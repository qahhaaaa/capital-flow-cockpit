// L5 mindshare proxy — CoinGecko /search/trending (free, no key). A manipulable ATTENTION
// proxy (trending searches + categories) standing in for paid mindshare (Kaito). Blocked on
// direct connection here, so routed via the proxy-aware getJsonViaProxy.
import { normalizeTrending } from "../layers/narrative.mjs";
import { getJsonViaProxy } from "./http.mjs";

export const TRENDING_URL = "https://api.coingecko.com/api/v3/search/trending";

export async function loadMindshareSnapshot({ getJson = (url) => getJsonViaProxy(url) } = {}) {
  const raw = await getJson(TRENDING_URL);
  return { source: "coingecko-trending", ...normalizeTrending(raw) };
}
