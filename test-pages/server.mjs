// Controlled test page for Quick Debug (implementation plan, step 6).
// Produces: successes, 4xx/5xx errors, a dropped connection, a request Chrome blocks (unsafe port),
// redirects, a slow response, several resource types and a URL with secrets.
//   node test-pages/server.mjs [port]   then open http://127.0.0.1:<port>/ with DevTools.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Quick Debug test page</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
<h1>Quick Debug test page</h1>
<p>Open DevTools → Quick Debug, then reload. Expected results are listed in docs/test-plan.md.</p>
<img src="/image.png" alt=""><img src="/missing.png" alt="">
<button id="again">Run fetches again</button>
<script src="/app.js"></script>
</body></html>`;

const app = `
async function run() {
  const urls = [
    "/api/ok", "/api/created", "/api/unauthorized", "/api/not-found", "/api/error", "/api/unavailable",
    "/redirect", "/slow", "/drop", "/api/data?page=1&access_token=SECRET-TOKEN-123&lang=en",
    "http://127.0.0.1:9/blocked-port",
  ];
  for (const url of urls) {
    try { await fetch(url, { method: url.includes("created") ? "POST" : "GET" }); } catch (e) { /* failures are the point */ }
  }
}
document.getElementById("again").addEventListener("click", run);
run();
`;

const routes = {
  "/": (res) => send(res, 200, "text/html; charset=utf-8", page),
  "/style.css": (res) => send(res, 200, "text/css", "body{font-family:sans-serif;margin:2rem}"),
  "/app.js": (res) => send(res, 200, "text/javascript", app),
  "/image.png": (res) => send(res, 200, "image/png", PNG),
  "/missing.png": (res) => send(res, 404, "text/plain", "not found"),
  "/api/ok": (res) => json(res, 200, { ok: true }),
  "/api/created": (res) => json(res, 201, { id: 1 }),
  "/api/unauthorized": (res) => json(res, 401, { error: "login required" }),
  "/api/not-found": (res) => json(res, 404, { error: "no such item" }),
  "/api/error": (res) => json(res, 500, { error: "boom" }),
  "/api/unavailable": (res) => json(res, 503, { error: "try later" }),
  "/api/data": (res) => json(res, 200, { items: [] }),
  "/redirect": (res) => { res.writeHead(302, { Location: "/api/ok" }); res.end(); },
  "/slow": (res) => setTimeout(() => json(res, 200, { slow: true }), 1500),
  "/drop": (res) => res.socket?.destroy(),
};

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
function json(res, status, body) {
  send(res, status, "application/json", JSON.stringify(body));
}

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  (routes[path] ?? ((r) => send(r, 404, "text/plain", "unknown route")))(res);
}).listen(port, "127.0.0.1", () => console.log(`Quick Debug test page: http://127.0.0.1:${port}/`));
