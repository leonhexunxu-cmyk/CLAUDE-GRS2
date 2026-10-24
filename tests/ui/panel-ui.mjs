// End-to-end check of the built panel in Chromium with a fake chrome.devtools API.
// Covers every feature with counted clicks (the three-click rule), privacy
// masking, the command console, Halloween mode and /spooky, narrow and wide
// layouts, themes, and a 5,000-request performance sample.
//   npm run test:ui                       (builds first)
//   SCREENSHOTS=dir npm run test:ui       (also saves screenshots)
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
const shots = process.env.SCREENSHOTS;

/** HAR entry shaped like Chrome's, with phases that add up to `time` (as verified in real Chrome). */
function entry(i, o = {}) {
  const time = o.time ?? 20 + (i % 50);
  const failed = (o.status ?? 200) === 0;
  return {
    startedDateTime: new Date(Date.UTC(2026, 9, 24, 12, 0, 0, i)).toISOString(),
    time,
    request: { method: o.method ?? "GET", url: o.url ?? `https://shop.test/api/item/${i}`, httpVersion: "h2",
      headers: [{ name: "Cookie", value: "sid=COOKIESECRET" }, { name: "Authorization", value: "Bearer AUTHSECRET" }] },
    response: {
      status: o.status ?? 200, statusText: o.statusText ?? "OK", redirectURL: o.redirectURL ?? "", httpVersion: "h2",
      content: { mimeType: o.mime ?? "application/json", size: 100 }, _transferSize: 512, _error: o.error ?? null,
    },
    timings: failed
      ? { blocked: time, dns: -1, connect: -1, ssl: -1, send: 0, wait: 0, receive: 0 }
      : { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 0.1, wait: time - 4.1, receive: 3, _blocked_queueing: 0.5 },
    _resourceType: o.type ?? "fetch",
    ...(o.initiator ? { _initiator: o.initiator } : {}),
  };
}

const initial = [
  entry(1, { url: "https://shop.test/", type: "document", mime: "text/html" }),
  entry(2, { url: "https://shop.test/app.js", type: "script", mime: "text/javascript" }),
  entry(3, { url: "https://shop.test/logo.png", status: 404, statusText: "Not Found", type: "image", mime: "text/plain" }),
  entry(4, {
    url: "https://shop.test/api/cart?session=SUPERSECRET&page=1", status: 500, statusText: "Internal Server Error",
    initiator: { type: "script", stack: { callFrames: [{ functionName: "loadCart", url: "https://shop.test/app.js", lineNumber: 41, columnNumber: 2 }] } },
  }),
  entry(5, { url: "https://shop.test/api/down", status: 0, statusText: "", error: "net::ERR_CONNECTION_REFUSED", time: 3 }),
  entry(6, { url: "https://shop.test/old", status: 301, statusText: "Moved Permanently", redirectURL: "https://shop.test/new?token=REDIRSECRET", type: "document" }),
  entry(7, { url: "https://shop.test/api/report", time: 2400 }),
  entry(8, { url: "https://shop.test/api/jobs", method: "POST", status: 202, statusText: "Accepted" }),
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
      panels: {
        themeName: "default",
        setThemeChangeHandler() {},
        openResource: (url, line, cb) => { window.__opened = { url, line }; cb?.(); },
        network: { show: (o) => (window.__networkShown = o ?? {}) },
      },
      inspectedWindow: { reload: () => (window.__reloaded = true) },
    },
  };
  Object.defineProperty(window, "chrome", { value: chrome, configurable: true });
  window.__finish = (e) => { window.__har.push(e); listeners.finished.forEach((cb) => cb(e)); };
  window.__silent = (e) => window.__har.push(e);
  window.__navigate = () => { window.__har = []; listeners.navigated.forEach((cb) => cb("https://shop.test/")); };
}

const browser = await chromium.launch();

async function openPanel({ width = 1200, height = 700, date = "2026-10-24T12:00:00", reducedMotion = "no-preference", acceptDownloads = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion, acceptDownloads });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.clock.setFixedTime(new Date(date));
  await page.addInitScript(fakeChrome, initial);
  await page.goto(`${base}/panel.html`);
  await page.waitForFunction((n) => document.querySelectorAll("#rows tr").length === n, initial.length);
  return { context, page };
}

// ---- Click audit helpers: every feature starts from the main view and counts real clicks. ----
const audit = [];
let clicks = 0;
let page;
const click = async (selector) => {
  clicks++;
  await page.click(selector);
};
const choose = async (selector, value) => {
  clicks += 2; // opening a native <select> and picking an option
  await page.selectOption(selector, value);
};
async function mainView() {
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.querySelectorAll("details[open]").forEach((d) => (d.open = false));
    if (!document.getElementById("detail").hidden) document.getElementById("close").click();
  });
  await page.fill("#search", "");
  await page.dispatchEvent("#search", "input");
  await page.waitForTimeout(150); // search is debounced (80 ms)
  await page.evaluate(() => document.querySelector('[data-view="all"]').click());
}
async function feature(name, layout, fn) {
  await mainView();
  clicks = 0;
  await fn();
  audit.push({ name, layout, clicks });
  assert.ok(clicks <= 3, `${name} (${layout}) took ${clicks} clicks`);
}
const rows = () => page.locator("#rows tr").count();
const text = (sel) => page.locator(sel).innerText();
const rowOf = (fragment) => `#rows tr:has(td.c-name[title*="${fragment}"])`;
const consoleText = () => page.locator("#console-log").innerText();
async function run(cmd) {
  await page.fill("#console-input", cmd);
  await page.press("#console-input", "Enter");
}
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

// =================== Wide layout, during Halloween ===================
let ctx = await openPanel();
page = ctx.page;

assert.equal(await page.getAttribute("html", "data-season"), "halloween", "seasonal styling active on Oct 24, 2026");
assert.ok(await page.locator(".season-corner").isVisible(), "small spiderweb accent visible");
assert.equal(await text('[data-count="total"]'), "8");
assert.equal(await text('.views [data-count="problems"]'), "4");
assert.equal(await text('.views [data-count="httpErrors"]'), "2");
assert.ok(await page.locator("#notice").isVisible());
assert.equal(await page.locator("#detail").isVisible(), false);
assert.equal(await page.locator("#more").isVisible(), false, "wide panels show filters inline, not in a menu");

// Counts are consistent with the classification of every row.
const classes = await page.$$eval("#rows tr", (trs) => trs.map((tr) => tr.className));
assert.equal(classes.filter((c) => c.includes("o-http-error")).length, 2);
assert.equal(classes.filter((c) => c.includes("o-failed")).length, 1);
assert.equal(classes.filter((c) => c.includes("o-redirect")).length, 1);

// Privacy: the list never shows the secret, even in tooltips.
const listHtml = await page.locator("#rows").innerHTML();
assert.ok(!listHtml.includes("SUPERSECRET") && !listHtml.includes("REDIRSECRET"), "list masks secrets");

for (const [view, n] of [["all", 8], ["problems", 4], ["failed", 1], ["http-error", 2], ["redirect", 1], ["slow", 1]]) {
  await feature(`View: ${view}`, "wide", async () => {
    await click(`.views [data-view="${view}"]`);
    assert.equal(await rows(), n);
  });
}
await feature("Search by text", "wide", async () => {
  await click("#search");
  await page.keyboard.type("api");
  await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 4);
});
await feature("Filter by resource type", "wide", async () => {
  await choose("#type", "image");
  assert.equal(await rows(), 1);
});
await page.selectOption("#type", "all");

await feature("Inspect a request", "wide", async () => {
  await click(rowOf("/api/cart"));
  assert.ok(await page.locator("#detail").isVisible());
  assert.equal(await text("#d-pill"), "500");
  assert.match(await text("#d-analysis"), /Likely source: The server/);
  assert.match(await text("#d-analysis"), /Started by a script\s*loadCart in https:\/\/shop\.test\/app\.js:42/);
  const url = await text("#d-url");
  assert.match(url, /session=\[REDACTED\]&page=1/);
  assert.ok(!url.includes("SUPERSECRET"), "inspector masks by default");
  assert.ok(!(await page.locator("#detail").innerHTML()).includes("SUPERSECRET"), "no secret anywhere in the details DOM");
});
await feature("Explain a status code (?)", "wide", async () => {
  await click(rowOf("/api/jobs"));
  await click("#status-help");
  assert.match(await text("#d-help"), /202 Accepted/);
  assert.match(await text("#d-help"), /Not an error/);
  assert.equal(await page.getAttribute("#d-help-ref", "href"), "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/202");
});
await feature("Explain a network error (?)", "wide", async () => {
  await click(rowOf("/api/down"));
  await click("#status-help");
  assert.match(await text("#d-help"), /net::ERR_CONNECTION_REFUSED/);
  assert.match(await text("#d-timing-note"), /Not reported by DevTools: dns, connect, ssl/);
  assert.match(await text("#d-analysis"), /No response phases/);
});
await feature("Copy URL (redacted by default)", "wide", async () => {
  await click(rowOf("/api/cart"));
  await click("#copy-url");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("redacted"));
});
assert.equal(await clipboard(), "https://shop.test/api/cart?session=[REDACTED]&page=1");
await feature("Reveal and copy the original URL", "wide", async () => {
  await click(rowOf("/api/cart"));
  await click("#reveal-url");
  assert.match(await text("#d-url"), /SUPERSECRET/);
  assert.equal(await text("#copy-url"), "Copy original URL");
  await click("#copy-url");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("unredacted"));
});
assert.equal(await clipboard(), "https://shop.test/api/cart?session=SUPERSECRET&page=1");
// Reveal is per selection: choosing another request masks again.
await page.click(rowOf("/old"));
await page.click(rowOf("/api/cart"));
assert.ok(!(await text("#d-url")).includes("SUPERSECRET"), "reveal resets when the selection changes");
assert.equal(await text("#copy-url"), "Copy URL");

await feature("Copy diagnostic report", "wide", async () => {
  await click(rowOf("/api/cart"));
  await click("#copy");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("Report copied"));
});
const report = await clipboard();
assert.match(report, /session=\[REDACTED\]&page=1/);
for (const secret of ["SUPERSECRET", "COOKIESECRET", "AUTHSECRET"]) assert.ok(!report.includes(secret), `${secret} not in report`);
assert.match(report, /Likely source: The server/);

async function captureDownload(fn) {
  const [download] = await Promise.all([page.waitForEvent("download"), fn()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), content: await readFile(path, "utf8") };
}
let file;
await feature("Download technical report (selected request)", "wide", async () => {
  await click(rowOf("/old"));
  file = await captureDownload(() => click("#download"));
});
assert.match(file.name, /^quick-debug-report-.*\.md$/);
assert.match(file.content, /# Quick Debug technical report/);
assert.match(file.content, /token=\[REDACTED\]/);
assert.ok(!file.content.includes("REDIRSECRET"));
await feature("Download report of visible requests (Markdown)", "wide", async () => {
  await click("#actions > summary");
  file = await captureDownload(() => click('[data-action="download-md"]'));
});
assert.match(file.content, /\| 8 \| 4 \| 1 \| 2 \| 1 \| 1 \|/);
await feature("Download report of visible requests (JSON)", "wide", async () => {
  await click("#actions > summary");
  file = await captureDownload(() => click('[data-action="download-json"]'));
});
const json = JSON.parse(file.content);
assert.equal(json.requests.length, 8);
for (const secret of ["SUPERSECRET", "REDIRSECRET", "COOKIESECRET", "AUTHSECRET"]) assert.ok(!file.content.includes(secret), `${secret} not in JSON`);

await feature("Open the initiating script in Sources", "wide", async () => {
  await click(rowOf("/api/cart"));
  await click("#open-source");
  assert.deepEqual(await page.evaluate(() => window.__opened), { url: "https://shop.test/app.js", line: 41 });
});
await feature("Show request in native Network panel", "wide", async () => {
  await click(rowOf("/api/cart"));
  await click("#open-network");
  assert.deepEqual(await page.evaluate(() => window.__networkShown), { filter: "/api/cart" }, "path only, no query values");
});
await feature("Preview the report", "wide", async () => {
  await click(rowOf("/api/cart"));
  await click("#detail details.more > summary");
  assert.ok(await page.locator("#d-report").isVisible());
});
await feature("Switch to dark theme", "wide", async () => {
  await click("#actions > summary");
  await click('[data-theme-choice="dark"]');
  assert.equal(await page.getAttribute("html", "data-theme"), "dark");
});
if (shots) {
  await page.click(rowOf("/api/cart"));
  await page.click("#status-help");
  await page.screenshot({ path: join(shots, "wide-dark-halloween.png") });
}
await feature("Switch back to automatic theme", "wide", async () => {
  await click("#actions > summary");
  await click('[data-theme-choice="auto"]');
  assert.equal(await page.getAttribute("html", "data-theme"), "light");
});
await feature("Run a console command", "wide", async () => {
  await click("#console-input");
  await page.keyboard.type("/help");
  await page.keyboard.press("Enter");
  assert.match(await consoleText(), /\/spooky/);
});
await feature("Show commands (menu)", "wide", async () => {
  await click("#actions > summary");
  await click('[data-action="help"]');
});
await feature("Reload page for a complete capture", "wide", async () => {
  await click("#reload");
  assert.equal(await page.evaluate(() => window.__reloaded), true);
});

// ---- Console behaviour ----
await mainView();
await run("/cls");
await run("/explain 202");
assert.match(await consoleText(), /202 Accepted/);
await run("rm -rf /");
assert.match(await consoleText(), /cannot run shell commands or JavaScript/);
await run("alert(document.cookie)");
await run("/eval 1+1");
assert.match(await consoleText(), /Unknown command \/eval/);
await run("/slowest 99");
assert.match(await consoleText(), /Usage: \/slowest/);
await run("/select 99");
assert.match(await consoleText(), /There is no row 99/);
await run("/copy");
assert.match(await consoleText(), /Select a request first/);
await run("/type video");
assert.match(await consoleText(), /No captured requests of type "video"/);
assert.equal(await page.evaluate(() => window.__opened?.url), "https://shop.test/app.js", "commands never open resources by themselves");
await run("/show errors");
assert.equal(await rows(), 2);
await run("/slowest 3");
const slowest = await consoleText();
assert.match(slowest, /1\.\s+2\.40 s\s+GET report/);
await run("/search SUPERSECRET");
assert.equal(await rows(), 0, "search matches only the masked URL, so it cannot locate secret values");
await run("/reset");
assert.equal(await rows(), 8);
await run("/select 4");
assert.equal(await text("#d-name"), "cart");
await run("/copy");
await page.waitForFunction(() => document.getElementById("console-log").textContent.includes("Redacted report copied"));
assert.ok(!(await clipboard()).includes("SUPERSECRET"), "/copy cannot bypass redaction");
await run("/download json");
await page.waitForFunction(() => document.getElementById("console-log").textContent.includes("Download started"));
const errorLines = await page.$$eval("#console-log .line.error", (ls) => ls.length);
const okLines = await page.$$eval("#console-log .line.ok", (ls) => ls.length);
assert.ok(errorLines >= 6 && okLines >= 5, "success and failure are visibly distinct");
// History: ↑ recalls previous inputs.
await page.click("#console-input");
await page.keyboard.press("ArrowUp");
assert.equal(await page.inputValue("#console-input"), "/download json");
await page.keyboard.press("ArrowUp");
assert.equal(await page.inputValue("#console-input"), "/copy");
await page.keyboard.press("Escape");

// Pins and usage
await run("/pin /search token");
assert.match(await consoleText(), /Cannot pin/);
await run("/pin /show problems");
assert.ok(await page.locator('#shortcuts button:text("/show problems")').isVisible());
await feature("Pinned shortcut", "wide", async () => {
  await click('#shortcuts button:text("/show problems")');
  assert.equal(await rows(), 4);
});
await feature("Reset command usage", "wide", async () => {
  await click("#actions > summary");
  await click('[data-action="reset-usage"]');
  await page.waitForFunction(() => document.getElementById("console-log").textContent.includes("usage counts were deleted"));
});
const stored = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
for (const secret of ["SUPERSECRET", "token", "shop.test", "cart"]) assert.ok(!stored.includes(secret), `localStorage holds no ${secret}`);
assert.match(stored, /qd\.pins/);
await run("/unpin /show problems");

// ---- /spooky ----
await run("/cls");
await run("/spooky");
assert.match(await consoleText(), /Boo! A small ghost drifts by/);
assert.equal(await page.locator(".spooky-ghost").count(), 1);
await run("/spooky");
assert.match(await consoleText(), /already floating/);
assert.equal(await page.locator(".spooky-ghost").count(), 1, "no overlapping animations");
// The ghost stays inside its own lane in the console, away from controls and data.
const lane = await page.locator(".spooky-lane").boundingBox();
const table = await page.locator(".list").boundingBox();
assert.ok(lane.y >= table.y + table.height, "lane is below the request list");
await page.waitForFunction(() => document.querySelectorAll(".spooky-ghost, .spooky-lane").length === 0, null, { timeout: 5000 });
assert.equal(await page.evaluate(() => document.getAnimations().length), 0, "no animations left after completion");
await run("/spooky");
await page.waitForFunction(() => document.querySelectorAll(".spooky-ghost").length === 0, null, { timeout: 5000 });
assert.equal(await page.evaluate(() => document.getAnimations().length), 0, "repeated runs leave nothing behind");

// ---- Keyboard, selection, live updates, clear and navigation (regressions) ----
await mainView();
await page.click("#rows tr:nth-child(1)");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
assert.equal(await page.locator('#rows tr[aria-selected="true"]').getAttribute("data-id"), "3");
await page.keyboard.press("Escape");
assert.equal(await page.locator("#detail").isVisible(), false);
await page.keyboard.press("/");
assert.equal(await page.evaluate(() => document.activeElement.id), "search");
await page.keyboard.press("Escape");
await page.locator("body").click({ position: { x: 5, y: 300 } });
await page.keyboard.press("`");
assert.equal(await page.evaluate(() => document.activeElement.id), "console-input");
await page.keyboard.press("Escape");

await page.evaluate((e) => { window.__finish(e); window.__finish(e); }, entry(9, { url: "https://shop.test/late.css", type: "stylesheet", mime: "text/css" }));
await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 9);
await page.evaluate((e) => window.__silent(e), entry(10, { url: "https://shop.test/api/beacon" }));
await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 10, null, { timeout: 5000 });

await feature("Clear the list", "wide", async () => {
  await click("#clear");
  assert.equal(await rows(), 0);
});
await page.waitForTimeout(2500);
assert.equal(await rows(), 0, "a background reconcile does not bring cleared requests back");
await page.evaluate(() => window.__navigate());
assert.equal(await page.locator("#notice").isVisible(), false);

// ---- Performance sample: 5,000 requests through the live path, then filter changes ----
const perf = await page.evaluate(async () => {
  const make = (i) => ({
    startedDateTime: new Date(Date.UTC(2026, 9, 24, 13, 0, 0, 0) + i).toISOString(), time: i % 97 === 0 ? 1500 : 30,
    request: { method: "GET", url: `https://shop.test/api/bulk/${i}?q=${i}&token=t${i}` },
    response: { status: i % 50 === 0 ? 404 : 200, statusText: "", content: { mimeType: "application/json" } },
    timings: { wait: 20 }, _resourceType: i % 3 ? "fetch" : "image",
  });
  const t0 = performance.now();
  for (let i = 0; i < 5000; i++) window.__finish(make(i));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t1 = performance.now();
  document.querySelector('.views [data-view="problems"]').click();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t2 = performance.now();
  document.querySelector('.views [data-view="all"]').click();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t3 = performance.now();
  return { ingestAndPaintMs: Math.round(t1 - t0), filterToProblemsMs: Math.round(t2 - t1), filterToAllMs: Math.round(t3 - t2), rows: document.querySelectorAll("#rows tr").length };
});
assert.equal(perf.rows, 5000);
const cdp = await ctx.context.newCDPSession(page);
await cdp.send("HeapProfiler.collectGarbage");
perf.jsHeapMB = Math.round(((await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576) * 10) / 10;
assert.deepEqual(page.errors, [], "no console or page errors (wide)");
await ctx.context.close();

// =================== Narrow layout (secondary controls collapse) ===================
ctx = await openPanel({ width: 520, height: 720 });
page = ctx.page;
assert.equal(await page.locator('.views [data-view="failed"]').isVisible(), false, "secondary views collapse");
assert.ok(await page.locator("#more").isVisible(), "filters menu shown instead");
assert.equal(await page.locator("#rows tr:first-child td.c-method").isVisible(), false, "method column hidden");
assert.equal(await page.locator("#rows tr:first-child td.c-type").isVisible(), false, "type column hidden");
assert.ok(await page.locator("#console-input").isVisible(), "console stays available");
for (const [view, n] of [["all", 8], ["problems", 4]]) {
  await feature(`View: ${view}`, "narrow", async () => {
    await click(`.views [data-view="${view}"]`);
    assert.equal(await rows(), n);
  });
}
for (const [view, n] of [["failed", 1], ["http-error", 2], ["redirect", 1], ["slow", 1]]) {
  await feature(`View: ${view}`, "narrow", async () => {
    await click("#more > summary");
    await click(`#more [data-view="${view}"]`);
    assert.equal(await rows(), n);
    assert.match(await text("#more-label"), /Filters · /, "hidden filter state is shown on the menu");
  });
}
await feature("Filter by resource type", "narrow", async () => {
  await click("#more > summary");
  await choose("#type-narrow", "image");
  assert.equal(await rows(), 1);
});
await page.evaluate(() => { const s = document.getElementById("type-narrow"); s.value = "all"; s.dispatchEvent(new Event("change")); });
await feature("Inspect a request", "narrow", async () => {
  await click(rowOf("/api/cart"));
  const list = await page.locator(".list").boundingBox();
  const detail = await page.locator("#detail").boundingBox();
  assert.ok(detail.y >= list.y + list.height - 1, "details stack below the list");
});
await feature("Copy diagnostic report", "narrow", async () => {
  await click(rowOf("/api/cart"));
  await click("#copy");
});
await feature("Download report of visible requests (Markdown)", "narrow", async () => {
  await click("#actions > summary");
  await captureDownload(() => click('[data-action="download-md"]'));
});
if (shots) {
  await page.evaluate(() => { document.querySelectorAll("details[open]").forEach((d) => (d.open = false)); });
  await page.click(rowOf("/api/cart"));
  await page.screenshot({ path: join(shots, "narrow-light-halloween.png") });
}
assert.deepEqual(page.errors, [], "no console or page errors (narrow)");
await ctx.context.close();

// =================== Reduced motion ===================
ctx = await openPanel({ reducedMotion: "reduce" });
page = ctx.page;
await run("/spooky");
assert.match(await consoleText(), /Reduced motion is on/);
assert.equal(await page.locator(".spooky-ghost, .spooky-lane").count(), 0);
assert.equal(await page.evaluate(() => document.getAnimations().length), 0, "static response only");
await ctx.context.close();

// =================== Season boundaries ===================
ctx = await openPanel({ date: "2026-11-01T23:30:00" });
assert.equal(await ctx.page.getAttribute("html", "data-season"), "halloween", "still on, Nov 1 inclusive");
await ctx.context.close();

ctx = await openPanel({ date: "2026-11-02T00:00:01" });
page = ctx.page;
assert.equal(await page.getAttribute("html", "data-season"), null, "expired after Nov 1");
assert.equal(await page.locator(".season-corner").isVisible(), false);
await run("/spooky");
assert.match(await consoleText(), /Halloween mode has expired/);
assert.equal(await page.locator("#console-log .line.ok").count(), 0, "expired /spooky does not claim success");
assert.equal(await page.locator(".spooky-ghost").count(), 0);
if (shots) {
  await page.click(rowOf("/api/cart"));
  await page.screenshot({ path: join(shots, "wide-light-after-season.png") });
}
assert.deepEqual(page.errors, [], "no console or page errors (expired)");
await ctx.context.close();

await browser.close();
server.close();

console.log("Feature-access audit (clicks from the main Quick Debug view):");
for (const { name, layout, clicks: n } of audit) console.log(`  ${n}  ${layout.padEnd(6)}  ${name}`);
console.log(`  max: ${Math.max(...audit.map((a) => a.clicks))} clicks over ${audit.length} features`);
console.log("Performance (5,000 requests):", JSON.stringify(perf));
console.log("UI checks passed.");
