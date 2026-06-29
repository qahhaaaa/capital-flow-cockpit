import test from "node:test";
import assert from "node:assert/strict";

import { parseRawHttpResponse, decodeChunkedBody, resolveProxyUrl } from "../src/cockpit/providers/http.mjs";

test("parseRawHttpResponse: plain body after the header separator", () => {
  const raw = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"a\":1}";
  assert.equal(parseRawHttpResponse(raw), '{"a":1}');
});

test("parseRawHttpResponse: decodes chunked transfer-encoding", () => {
  const raw = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n";
  assert.equal(parseRawHttpResponse(raw), "hello");
});

test("parseRawHttpResponse: throws on non-2xx status", () => {
  assert.throws(() => parseRawHttpResponse("HTTP/1.1 402 Payment Required\r\n\r\nnope"), /402/);
});

test("decodeChunkedBody: concatenates multiple chunks", () => {
  assert.equal(decodeChunkedBody("3\r\nfoo\r\n3\r\nbar\r\n0\r\n\r\n"), "foobar");
});

test("resolveProxyUrl: reads HTTPS_PROXY/HTTP_PROXY/ALL_PROXY from env, else empty", () => {
  assert.equal(resolveProxyUrl({ HTTPS_PROXY: "http://127.0.0.1:7897" }), "http://127.0.0.1:7897");
  assert.equal(resolveProxyUrl({ ALL_PROXY: "http://p:1" }), "http://p:1");
  assert.equal(resolveProxyUrl({}), "");
});
