// End-to-end check of the built panel in Chromium with a fake chrome.devtools API.
// Covers the MVP features, the click-depth rule (each feature is reached by
// counted clicks from the main view) and a 5,000-request performance sample.
//   npm run test:ui            (builds first)
//   SCREENSHOT=path.png npm run test:ui
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Playwright is an optional, test-only tool (not a project dependency); resolved like require() so a global install works.
const { chromium } = createRequire(import.meta.url)("playwright");

const dist = join(dirname(fileURLToPath(import.meta.url)), "../../dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(dist, new URL(req.url, "http://x").pathname));
    res.writeHead(200, { "Content-Type": types[extname(req.url)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

function entry(i, o = {}) {
  return {
    startedDateTime: new Date(Date.UTC(2026, 9, 24, 12, 0, 0, i)).toISOString(),
    time: o.time ?? 20 + (i % 50),
    request: { method: o.method ?? "GET", url: o.url ?? `https://shop.test/api/item/${i}`, httpVersion: "h2" },
    response: {
      status: o.status ?? 200, statusText: o.statusText ?? "OK", redirectURL: o.redirectURL ?? "", httpVersion: "h2",
      content: { mimeType: o.mime ?? "application/json", size: 100 }, _transferSize: 512, _error: o.error ?? null,
    },
    timings: { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 0.1, wait: (o.time ?? 20 + (i % 50)) - 5, receive: 3 },
    _resourceType: o.type ?? "fetch",
  };
}

const initial = [
  entry(1, { url: "https://shop.test/", type: "document", mime: "text/html" }),
  entry(2, { url: "https://shop.test/app.js", type: "script", mime: "text/javascript" }),
  entry(3, { url: "https://shop.test/logo.png", status: 404, statusText: "Not Found", type: "image", mime: "text/plain" }),
  entry(4, { url: "https://shop.test/api/cart?session=SUPERSECRET&page=1", status: 500, statusText: "Internal Server Error" }),
  entry(5, { url: "https://shop.test/api/down", status: 0, statusText: "", error: "net::ERR_CONNECTION_REFUSED" }),
  entry(6, { url: "https://shop.test/old", status: 301, statusText: "Moved Permanently", redirectURL: "https://shop.test/new", type: "document" }),
  entry(7, { url: "https://shop.test/api/report", time: 2400 }),
];

// Mirrors Chrome: getHAR returns the current Network log; a navigation resets it.
function fakeChrome(entries) {
  const listeners = { finished: [], navigated: [] };
  window.__har = [...entries];
  const chrome = {
    devtools: {
      network: {
        getHAR: (cb) => setTimeout(() => cb({ entries: [...window.__har] }), 0),
        onRequestFinished: { addListener: (cb) => listeners.finished.push(cb) },
        onNavigated: { addListener: (cb) => listeners.navigated.push(cb) },
      },
      panels: { themeName: "default", setThemeChangeHandler() {}, network: { show: (o) => (window.__networkShown = o ?? {}) } },
      inspectedWindow: { reload: () => (window.__reloaded = true) },
    },
  };
  Object.defineProperty(window, "chrome", { value: chrome, configurable: true });
  window.__finish = (e) => { window.__har.push(e); listeners.finished.forEach((cb) => cb(e)); };
  // A request that completes without firing onRequestFinished (seen in Chrome for unread fetch bodies).
  window.__silent = (e) => window.__har.push(e);
  window.__navigate = () => { window.__har = []; listeners.navigated.forEach((cb) => cb("https://shop.test/")); };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1100, height: 520 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

// Count clicks per feature: the audit records the real number of clicks we needed.
const audit = [];
let clicks = 0;
const click = async (selector) => {
  clicks++;
  await page.click(selector);
};
const feature = async (name, fn) => {
  clicks = 0;
  await fn();
  audit.push({ name, clicks });
  assert.ok(clicks <= 3, `${name} took ${clicks} clicks`);
};
const rows = () => page.locator("#rows tr").count();
const text = (sel) => page.locator(sel).innerText();

await page.addInitScript(fakeChrome, initial);
await page.goto(`${base}/panel.html`);
await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 7);

// Overview
assert.equal(await text('[data-count="total"]'), "7");
assert.equal(await text('[data-count="problems"]'), "4");
assert.equal(await text('[data-count="httpErrors"]'), "2");
assert.ok(await page.locator("#notice").isVisible(), "partial-capture notice visible");
assert.equal(await page.locator("#detail").isVisible(), false, "details hidden until a request is selected");
assert.equal(await text("#rows tr:nth-child(5) td.c-status"), "(failed)");

await feature("Show problem requests", async () => {
  await click('[data-view="problems"]');
  assert.equal(await rows(), 4);
});
await feature("Show requests with no response", async () => {
  await click('[data-view="failed"]');
  assert.equal(await rows(), 1);
});
await feature("Show HTTP errors", async () => {
  await click('[data-view="http-error"]');
  assert.equal(await rows(), 2);
});
await feature("Show redirects", async () => {
  await click('[data-view="redirect"]');
  assert.equal(await rows(), 1);
});
await feature("Show slow requests", async () => {
  await click('[data-view="slow"]');
  assert.equal(await rows(), 1);
});
await feature("Show all requests", async () => {
  await click('[data-view="all"]');
  assert.equal(await rows(), 7);
});
await feature("Search by text", async () => {
  await click("#search");
  await page.keyboard.type("api");
  await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 3);
});
await page.fill("#search", "");
await page.dispatchEvent("#search", "input");
await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 7);
await feature("Filter by resource type", async () => {
  clicks++; // opening the native <select> is one click, choosing an option is the second
  await page.selectOption("#type", "image");
  clicks++;
  assert.equal(await rows(), 1);
});
await page.selectOption("#type", "all");

await feature("Inspect a request", async () => {
  await click("#rows tr:nth-child(4)");
  assert.ok(await page.locator("#detail").isVisible());
  assert.match(await text("#d-outcome"), /HTTP error \(500 Internal Server Error\)/);
  assert.match(await text("#d-meaning"), /5xx/);
  assert.equal(await page.locator("#d-timing dd.na").count(), 3, "dns/connect/ssl shown as n/a");
});
await feature("Copy a diagnostic report", async () => {
  await click("#rows tr:nth-child(4)");
  await click("#copy");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("copied"));
});
const report = await page.evaluate(() => navigator.clipboard.readText());
assert.match(report, /session=\[REDACTED\]&page=1/);
assert.ok(!report.includes("SUPERSECRET"), "secret not in report");
assert.match(report, /Capture: partial/);

await feature("Copy the full URL", async () => {
  await click("#rows tr:nth-child(4)");
  await click("#copy-url");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("URL copied"));
});
await feature("Preview the report", async () => {
  await click("#rows tr:nth-child(4)");
  await click("#detail summary");
  assert.ok(await page.locator("#d-report").isVisible());
});
await feature("Show request in native Network panel", async () => {
  await click("#rows tr:nth-child(4)");
  await click("#open-network");
  assert.deepEqual(await page.evaluate(() => window.__networkShown), { filter: initial[3].request.url });
});
await feature("Close details", async () => {
  await click("#rows tr:nth-child(4)");
  await click("#close");
  assert.equal(await page.locator("#detail").isVisible(), false);
});
await feature("Reload page for a complete capture", async () => {
  await click("#reload");
  assert.equal(await page.evaluate(() => window.__reloaded), true);
});

// Keyboard: arrows move selection, Esc closes, "/" focuses search.
await page.click("#rows tr:nth-child(1)");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
assert.equal(await page.locator('#rows tr[aria-selected="true"]').getAttribute("data-id"), "3");
assert.equal(await text("#d-name"), "logo.png");
await page.keyboard.press("Escape");
assert.equal(await page.locator("#detail").isVisible(), false);
await page.keyboard.press("/");
assert.equal(await page.evaluate(() => document.activeElement.id), "search");

// Selection survives a filter that hides it (details stay open).
await page.click("#rows tr:nth-child(2)");
await page.click('[data-view="problems"]');
assert.ok(await page.locator("#detail").isVisible());
await page.click('[data-view="all"]');

// Live events append; duplicates are ignored.
await page.evaluate((e) => { window.__finish(e); window.__finish(e); }, entry(8, { url: "https://shop.test/late.css", type: "stylesheet", mime: "text/css" }));
await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 8);
assert.ok((await page.locator("#type option").allInnerTexts()).includes("stylesheet"));
// A request that never fires onRequestFinished still shows up via the getHAR reconcile.
await page.evaluate((e) => window.__silent(e), entry(9, { url: "https://shop.test/api/beacon" }));
await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 9, null, { timeout: 5000 });

await feature("Clear the list", async () => {
  await click("#clear");
  assert.equal(await rows(), 0);
  assert.match(await text("#empty"), /No requests captured yet/);
});
await page.waitForTimeout(2500); // a background reconcile must not bring cleared requests back
assert.equal(await rows(), 0);

// Navigation: list resets, capture becomes complete.
await page.evaluate(() => window.__navigate());
assert.equal(await page.locator("#notice").isVisible(), false);
assert.match(await text("#empty"), /since the last navigation/);
await page.waitForTimeout(600);
assert.equal(await rows(), 0);

// Performance sample: 5,000 requests through the live path, then a filter change.
const perf = await page.evaluate(async () => {
  const make = (i) => ({
    startedDateTime: new Date(Date.UTC(2026, 9, 24, 13, 0, 0, 0) + i).toISOString(), time: i % 97 === 0 ? 1500 : 30,
    request: { method: "GET", url: `https://shop.test/api/bulk/${i}?q=${i}` },
    response: { status: i % 50 === 0 ? 404 : 200, statusText: "", content: { mimeType: "application/json" } },
    timings: { wait: 20 }, _resourceType: i % 3 ? "fetch" : "image",
  });
  const t0 = performance.now();
  for (let i = 0; i < 5000; i++) window.__finish(make(i));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t1 = performance.now();
  document.querySelector('[data-view="problems"]').click();
  const t2 = performance.now();
  document.querySelector('[data-view="all"]').click();
  const t3 = performance.now();
  return { ingestAndPaintMs: Math.round(t1 - t0), filterToProblemsMs: Math.round(t2 - t1), filterToAllMs: Math.round(t3 - t2), rows: document.querySelectorAll("#rows tr").length };
});
assert.equal(perf.rows, 5000);
const cdp = await context.newCDPSession(page);
await cdp.send("HeapProfiler.collectGarbage");
const { usedSize } = await cdp.send("Runtime.getHeapUsage");
perf.jsHeapMB = Math.round((usedSize / 1048576) * 10) / 10;

if (process.env.SCREENSHOT) {
  await page.evaluate(() => window.__navigate());
  await page.evaluate((list) => list.forEach((e) => window.__finish(e)), initial);
  await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 7);
  await page.click("#rows tr:nth-child(4)");
  await page.screenshot({ path: process.env.SCREENSHOT });
}

assert.deepEqual(errors, [], "no console or page errors");
await browser.close();
server.close();

console.log("Feature-access audit (clicks from the main Quick Debug view):");
for (const { name, clicks: n } of audit) console.log(`  ${String(n).padStart(1)}  ${name}`);
console.log("Performance (5,000 requests):", JSON.stringify(perf));
console.log("UI checks passed.");
