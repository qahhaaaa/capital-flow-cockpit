// Proxy-aware JSON GET for hosts only reachable via the local proxy (e.g. OKX / CoinGecko
// behind a regional block). Ports the proven CONNECT-tunnel approach from the retired v1 OKX
// provider: read HTTPS_PROXY/HTTP_PROXY/ALL_PROXY from env -> CONNECT to proxy -> TLS -> raw
// HTTP/1.1 -> chunked decode. Falls back to direct fetch when no proxy is configured.
// IMPORTANT: parsing is byte-accurate (Buffer), because chunk sizes are in BYTES while
// responses may contain multi-byte UTF-8 (coin names/emoji) — char-based slicing corrupts them.
import { request as httpRequest } from "node:http";
import { connect as tlsConnect } from "node:tls";

const PROXY_ENV_NAMES = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"];

export function buildBrowserHeaders() {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "identity",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
}

export function resolveProxyUrl(env = process.env) {
  for (const name of PROXY_ENV_NAMES) {
    if (env[name]) return env[name];
  }
  return "";
}

export async function getJsonViaProxy(url, { headers = buildBrowserHeaders(), timeoutMs = 20000 } = {}) {
  const proxyUrl = resolveProxyUrl();
  const text = proxyUrl
    ? await fetchTextViaHttpProxy(url, proxyUrl, headers, timeoutMs)
    : await fetchTextDirect(url, headers, timeoutMs);
  return JSON.parse(text);
}

async function fetchTextDirect(url, headers, timeoutMs) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`request failed ${response.status}: ${text.slice(0, 200)}`);
  return text;
}

function fetchTextViaHttpProxy(url, proxyUrl, headers, timeoutMs) {
  const target = new URL(url);
  const proxy = new URL(proxyUrl);
  if (!["http:", "https:"].includes(proxy.protocol)) {
    throw new Error(`Unsupported proxy protocol: ${proxy.protocol}`);
  }

  return new Promise((resolvePromise, reject) => {
    const request = httpRequest({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: "CONNECT",
      path: `${target.hostname}:443`,
      headers: proxyConnectHeaders(proxy, target),
      timeout: timeoutMs,
    });

    request.on("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed ${response.statusCode}`));
        return;
      }
      const tlsSocket = tlsConnect({ socket, servername: target.hostname });
      const chunks = [];
      tlsSocket.setTimeout(timeoutMs);
      tlsSocket.on("secureConnect", () => tlsSocket.write(buildRawHttpRequest(target, headers)));
      tlsSocket.on("data", (chunk) => chunks.push(chunk));
      tlsSocket.on("end", () => {
        try { resolvePromise(parseRawHttpResponse(Buffer.concat(chunks))); } catch (error) { reject(error); }
      });
      tlsSocket.on("timeout", () => tlsSocket.destroy(new Error("proxy TLS timeout")));
      tlsSocket.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("proxy CONNECT timeout")));
    request.on("error", reject);
    request.end();
  });
}

function proxyConnectHeaders(proxy, target) {
  const headers = { host: `${target.hostname}:443` };
  if (proxy.username || proxy.password) {
    const token = Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
    headers["proxy-authorization"] = `Basic ${token}`;
  }
  return headers;
}

function buildRawHttpRequest(target, headers) {
  const path = `${target.pathname}${target.search}`;
  return [
    `GET ${path} HTTP/1.1`,
    `Host: ${target.host}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    "Connection: close",
    "",
    "",
  ].join("\r\n");
}

// Accepts a Buffer (live) or string (tests). Header is ASCII; body decode is byte-accurate.
export function parseRawHttpResponse(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
  const separator = buf.indexOf("\r\n\r\n");
  if (separator === -1) throw new Error("proxy response missing header separator");
  const header = buf.slice(0, separator).toString("latin1");
  const body = buf.slice(separator + 4);
  const status = Number(header.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1]);
  if (status < 200 || status >= 300) {
    throw new Error(`request failed ${status}: ${body.slice(0, 200).toString("utf8")}`);
  }
  const decoded = /transfer-encoding:\s*chunked/i.test(header) ? decodeChunkedBuffer(body) : body;
  return decoded.toString("utf8");
}

function decodeChunkedBuffer(buf) {
  let cursor = 0;
  const out = [];
  while (cursor < buf.length) {
    const lineEnd = buf.indexOf("\r\n", cursor);
    if (lineEnd === -1) throw new Error("invalid chunked response");
    const size = Number.parseInt(buf.slice(cursor, lineEnd).toString("latin1").split(";")[0], 16);
    if (!Number.isFinite(size)) throw new Error("invalid chunk size");
    cursor = lineEnd + 2;
    if (size === 0) break;
    out.push(buf.slice(cursor, cursor + size));
    cursor += size + 2;
  }
  return Buffer.concat(out);
}

// String-in/string-out wrapper kept for tests and convenience.
export function decodeChunkedBody(raw) {
  return decodeChunkedBuffer(Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8")).toString("utf8");
}
