import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

import { REFRESH } from "../src/config.mjs";
import { collectCockpit } from "./collect-cockpit.mjs";

const root = resolve("public");
const port = Number(process.env.PORT || 4173);
let collectionRunning = false;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(root, normalize(pathname).replace(/^[/\\]+/, ""));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(`Not found: ${join(".", pathname)}`);
  }
});

server.listen(port, () => {
  console.log(`Cockpit running at http://localhost:${port}`);
  void runCollection("startup");
  setInterval(() => void runCollection("interval"), REFRESH.clientPollMs);
});

async function runCollection(reason) {
  if (collectionRunning) return;
  collectionRunning = true;
  try {
    const { cockpit, outputPath } = await collectCockpit();
    console.log(`[cockpit:${reason}] regime=${cockpit.regime} points=${cockpit.meta.historyPoints} -> ${outputPath}`);
  } catch (error) {
    console.error(`[cockpit:${reason}] ${error.message}`);
  } finally {
    collectionRunning = false;
  }
}
