import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { SITE_PAGES } from "./site-pages.mjs";

const root = resolve(import.meta.dirname, "..");
const host = "127.0.0.1";
const mountPath = "/sift-ai-video-filter-site";
const parsedPort = Number.parseInt(process.env.PORT ?? "4173", 10);
const port = Number.isInteger(parsedPort) && parsedPort >= 1_024 && parsedPort <= 65_535
  ? parsedPort
  : 4_173;
const publicFiles = new Set([
  ...SITE_PAGES,
  "favicon.svg",
  "robots.txt",
  "script.js",
  "styles.css",
]);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(message);
}

async function sendFile(request, response, fileName, statusCode = 200) {
  const filePath = resolve(root, fileName);
  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error("Not a regular file");
    response.writeHead(statusCode, {
      "Cache-Control": "no-store",
      "Content-Length": String(file.size),
      "Content-Type": contentTypes.get(extname(fileName)) ?? "application/octet-stream",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method not allowed");
    return;
  }

  let pathName;
  try {
    pathName = decodeURIComponent(new URL(request.url ?? "/", `http://${host}:${port}`).pathname);
  } catch {
    sendText(response, 400, "Invalid request path");
    return;
  }

  const withinMount = pathName === mountPath || pathName.startsWith(`${mountPath}/`);
  if (!withinMount) {
    await sendFile(request, response, "404.html", 404);
    return;
  }

  const relativePath = pathName.slice(mountPath.length).replace(/^\/+/, "");
  const fileName = relativePath || "index.html";
  if (!publicFiles.has(fileName)) {
    await sendFile(request, response, "404.html", 404);
    return;
  }
  await sendFile(request, response, fileName);
});

server.on("error", (error) => {
  console.error(error instanceof Error ? error.message : "Test server failed.");
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Sift test server listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
