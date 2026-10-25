// Integration test in real Chromium DevTools (implementation plan, steps 2 and 6).
// Loads the built extension, opens the Quick Debug panel, loads the controlled
// test page and compares what the panel shows against chrome.devtools.network.getHAR.
//
// Needs a display (DevTools does not open in headless mode):
//   npm run build && xvfb-run -a node tests/integration/real-devtools.mjs
//
// Opening the panel uses DevTools-internal modules (InspectorView). That is test
// scaffolding only; if a Chrome update renames them, this script fails loudly.
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const { redactUrl } = await import("../../dist/redact.js");
const { formatMs } = await import("../../dist/format.js");
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ext = join(root, "dist");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pagePort = 8790 + Math.floor(Math.random() * 100);
const debugPort = 9300 + Math.floor(Math.random() * 100);

const server = spawn(process.execPath, [join(root, "test-pages/server.mjs"), String(pagePort)], { stdio: "ignore" });
const profile = mkdtempSync(join(tmpdir(), "quick-debug-"));
// CHROMIUM_PATH runs the test against a specific Chromium build (e.g. the oldest supported version).
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: false,
  viewport: null,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--auto-open-devtools-for-tabs", `--remote-debugging-port=${debugPort}`],
});

async function connect(match) {
  for (let i = 0; i < 60; i++) {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const target = list.find(match);
    if (target) {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((r) => ws.addEventListener("open", r));
      let n = 0;
      const pending = new Map();
      ws.addEventListener("message", (ev) => {
        const m = JSON.parse(ev.data);
        pending.get(m.id)?.(m);
      });
      const send = (method, params) => new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
      return {
        async evaluate(expression) {
          const m = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
          if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails));
          return m.result?.result?.value;
        },
        send,
        close: () => ws.close(),
      };
    }
    await sleep(250);
  }
  throw new Error("DevTools target not found");
}

/** Poll `fn` until it returns a truthy value or `timeoutMs` passes. Rethrows the last error on timeout. */
async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  if (lastError) throw lastError;
  return null;
}

let failed = false;
try {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  console.log(`Browser: ${(await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()).Browser}`);
  const base = `http://127.0.0.1:${pagePort}`;
  for (let i = 0; i < 20; i++) { try { await fetch(base); break; } catch { await sleep(100); } }
  await page.goto(base + "/");

  const devtools = await connect((t) => t.url.startsWith("devtools://"));
  // Wait until the DevTools frontend has booted before touching its internals. Calling
  // InspectorView.instance() earlier constructs a second view and throws ("Unable to create
  // settings" or "No locale data registered"), which is what failed on the slower CI runner.
  // The rendered Elements tab is the frontend's own signal that its UI and locale are ready.
  const ready = await waitFor(() => devtools.evaluate(`(() => {
    const find = (root) => root.querySelector("#tab-elements") || [...root.querySelectorAll("*")].some((el) => el.shadowRoot && find(el.shadowRoot));
    return Boolean(find(document));
  })()`), 30_000);
  assert.ok(ready, "DevTools frontend finished booting within 30 s");
  // The extension's panel is registered asynchronously after the frontend boots.
  const opened = await waitFor(() => devtools.evaluate(`(async () => {
    const UI = await import("./ui/legacy/legacy.js");
    const view = UI.InspectorView.InspectorView.instance();
    const id = view.tabbedPane.tabIds().find((x) => x.endsWith("QuickDebug"));
    if (!id) return null;
    await view.showPanel(id);
    return id;
  })()`), 15_000);
  assert.ok(opened, "Quick Debug panel registered in DevTools");
  const panel = await connect((t) => t.url.endsWith("/panel.html"));

  // Opened after the page loaded: the panel backfills from getHAR (asynchronously) and says capture may be partial.
  const rowCount = () => panel.evaluate(`document.querySelectorAll("#rows tr").length`);
  await waitFor(rowCount, 10_000);
  const first = await panel.evaluate(`({ rows: document.querySelectorAll("#rows tr").length, notice: !document.getElementById("notice").hidden })`);
  assert.equal(first.notice, true, "partial-capture notice shown before a navigation");
  assert.ok(first.rows > 0, "backfilled requests from before the panel opened");

  await page.reload();
  // Wait (bounded) until the page's 17 requests have finished and the panel shows the same list in the
  // same order as DevTools' log. Reconciliation is asynchronous, so a fixed sleep raced on slow runners.
  // If the panel never converges, the assertions below fail with the actual difference.
  await waitFor(() => panel.evaluate(`new Promise((r) => chrome.devtools.network.getHAR((log) => {
    const done = log.entries.filter((e) => e.response.status > 0 || e.response._error);
    const titles = [...document.querySelectorAll("#rows tr .c-name")].map((td) => td.title);
    r(done.length === 17 && titles.length === 17 && done.every((e, i) => titles[i] && titles[i].split("?")[0] === e.request.url.split("?")[0]));
  }))`), 30_000);

  const har = await panel.evaluate(`new Promise((r) => chrome.devtools.network.getHAR((log) => r(log.entries.map((e) => ({
    url: e.request.url, method: e.request.method, status: e.response.status, error: e.response._error || null,
    type: e._resourceType, time: e.time })))))`);
  const shown = await panel.evaluate(`[...document.querySelectorAll("#rows tr")].map((tr) => ({
    status: tr.querySelector(".c-status").textContent, method: tr.querySelector(".c-method").textContent,
    type: tr.querySelector(".c-type").textContent, title: tr.querySelector(".c-name").title, time: tr.querySelector(".c-time").textContent }))`);
  const state = await panel.evaluate(`({ notice: !document.getElementById("notice").hidden,
    counts: Object.fromEntries([...document.querySelectorAll("[data-count]")].map((s) => [s.dataset.count, Number(s.textContent)])) })`);

  // Every finished request in the native log is shown, with the same values.
  const finished = har.filter((e) => e.status > 0 || e.error);
  assert.equal(shown.length, finished.length, `panel shows ${shown.length} of ${finished.length} finished requests`);
  finished.forEach((e, i) => {
    const row = shown[i];
    assert.equal(row.title, redactUrl(e.url).url, `row ${i} URL (masked)`);
    assert.equal(row.time, formatMs(e.time), `row ${i} time`);
    assert.equal(row.method, e.method, `row ${i} method`);
    assert.equal(row.status, e.status > 0 ? String(e.status) : "(failed)", `row ${i} status`);
    assert.equal(row.type, e.type, `row ${i} type`);
  });
  assert.equal(state.notice, false, "capture is complete after a reload");

  const expected = { total: 17, failed: 2, httpErrors: 5, redirects: 1, slow: 1, problems: 8 };
  assert.deepEqual(state.counts, expected);

  const pick = (fragment) => panel.evaluate(`(() => {
    const row = [...document.querySelectorAll("#rows tr")].find((tr) => tr.querySelector(".c-name").title.includes(${JSON.stringify(fragment)}));
    row.click();
    return { pill: document.getElementById("d-pill").textContent, meaning: document.getElementById("d-meaning").textContent,
             report: document.getElementById("d-report").textContent, analysis: document.getElementById("d-analysis").textContent,
             timingNote: document.getElementById("d-timing-note").textContent, url: document.getElementById("d-url").textContent };
  })()`);
  const data = await pick("access_token");
  assert.ok(!data.report.includes("SECRET-TOKEN-123"), "token redacted in report");
  assert.match(data.report, /access_token=\[REDACTED\]/);
  assert.match(data.report, /Capture: recorded since the last page navigation/);
  assert.match((await pick("/drop")).meaning, /net::ERR_EMPTY_RESPONSE/);
  assert.match((await pick("/blocked-port")).meaning, /Chrome reported: net::ERR_UNSAFE_PORT/);
  assert.match((await pick("/api/unauthorized")).meaning, /can be expected behaviour/);
  assert.match((await pick("/slow")).report, /Duration:\s+1\.\d\d s \(slow\)/);

  assert.ok(!data.url.includes("SECRET-TOKEN-123"), "inspector masks the token by default");

  // Timing: every real entry's phases add up to its total (no inconsistency note).
  for (let i = 0; i < finished.length; i++) {
    const note = await panel.evaluate(`(() => { document.querySelectorAll("#rows tr")[${i}].click(); return document.getElementById("d-timing-note").textContent; })()`);
    assert.doesNotMatch(note, /add up to/, `timing consistent for ${finished[i].url}`);
  }

  // Analysis on real data: the initiator of a fetch is the test page's script.
  const ok = await pick("/api/created");
  assert.match(ok.analysis, /Started by a script/);
  assert.match(ok.analysis, /app\.js:\d+/);
  assert.match((await pick("/drop")).analysis, /Likely source: The server/);
  assert.match((await pick("/blocked-port")).analysis, /Likely source: The browser/);

  // Status help.
  await pick("/api/unavailable");
  const help = await panel.evaluate(`(() => { document.getElementById("status-help").click(); return document.getElementById("d-help").innerText; })()`);
  assert.match(help, /503 Service Unavailable/);

  // Console in real DevTools: allowlist, /explain and /spooky (cleans up after itself).
  const consoleRun = (cmd) => panel.evaluate(`(() => { const i = document.getElementById("console-input"); i.value = ${JSON.stringify(cmd)};
    document.getElementById("console-form").requestSubmit(); return document.getElementById("console-log").innerText; })()`);
  assert.match(await consoleRun("ls -la"), /cannot run shell commands or JavaScript/);
  assert.match(await consoleRun("/explain 202"), /Accepted/);
  const spookyLog = await consoleRun("/spooky");
  const seasonOn = await panel.evaluate(`document.documentElement.dataset.season === "halloween"`);
  if (seasonOn) {
    assert.match(spookyLog, /Boo!/);
    const leftovers = () => panel.evaluate(`document.querySelectorAll(".spooky-ghost,.spooky-lane").length + document.getAnimations().length`);
    await waitFor(async () => (await leftovers()) === 0, 10_000);
    assert.equal(await leftovers(), 0, "/spooky leaves nothing behind");
  } else {
    assert.match(spookyLog, /expired/);
  }

  // Download in real DevTools: the technical report reaches the downloads folder, redacted.
  const downloads = mkdtempSync(join(tmpdir(), "quick-debug-dl-"));
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const browserWs = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => browserWs.addEventListener("open", r));
  await new Promise((resolve) => {
    browserWs.addEventListener("message", (ev) => JSON.parse(ev.data).id === 1 && resolve());
    browserWs.send(JSON.stringify({ id: 1, method: "Browser.setDownloadBehavior", params: { behavior: "allow", downloadPath: downloads } }));
  });
  await pick("access_token");
  await panel.evaluate(`document.getElementById("download").click()`);
  let downloaded = [];
  for (let i = 0; i < 80 && downloaded.length === 0; i++) {
    await sleep(250);
    downloaded = readdirSync(downloads).filter((f) => f.endsWith(".md"));
  }
  browserWs.close();
  if (downloaded.length) {
    const content = readFileSync(join(downloads, downloaded[0]), "utf8");
    assert.match(content, /access_token=\[REDACTED\]/);
    assert.ok(!content.includes("SECRET-TOKEN-123"));
    console.log(`Download verified in real DevTools: ${downloaded[0]}`);
  } else {
    throw new Error("The report download did not reach the downloads folder");
  }
  rmSync(downloads, { recursive: true, force: true });

  // Hand-off to the Sources panel (initiator).
  await pick("/api/created");
  const hasSource = await panel.evaluate(`Boolean(document.getElementById("open-source"))`);
  assert.ok(hasSource, "Open in Sources offered for a script-initiated request");
  const selectedTab = () => devtools.evaluate(`(async () => (await import("./ui/legacy/legacy.js")).InspectorView.InspectorView.instance().tabbedPane.selectedTabId)()`);
  await panel.evaluate(`document.getElementById("open-source").click()`);
  await waitFor(async () => (await selectedTab()) === "sources", 10_000);
  assert.equal(await selectedTab(), "sources", "Open in Sources switches to the Sources panel");
  await devtools.evaluate(`(async () => { const v = (await import("./ui/legacy/legacy.js")).InspectorView.InspectorView.instance(); await v.showPanel(${JSON.stringify(opened)}); })()`);
  await waitFor(async () => (await selectedTab()) === opened, 10_000);

  // Hand-off to the native Network panel, using the request whose URL carries a secret.
  await pick("/api/error");
  if (process.env.SCREENSHOT) {
    const shot = await devtools.send("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(process.env.SCREENSHOT, Buffer.from(shot.result.data, "base64"));
  }
  await pick("access_token");
  const api = await panel.evaluate(`typeof chrome.devtools.panels.network?.show === "function"`);
  const hasButton = await panel.evaluate(`!document.getElementById("open-network").hidden`);
  // Feature detection: the button exists exactly when this Chrome provides the API.
  assert.equal(hasButton, api, "Network panel button shown if and only if chrome.devtools.panels.network.show exists");
  if (!api) {
    console.log("This Chrome has no chrome.devtools.panels.network.show; the hand-off button is correctly hidden.");
  } else {
    await panel.evaluate(`document.getElementById("open-network").click()`);
    await waitFor(async () => (await selectedTab()) === "network", 10_000);
    assert.equal(await selectedTab(), "network", "Show in Network panel switches to the native Network panel");
    // The Network filter is a contenteditable element labelled "Filter" (not an <input>). Other panels
    // have "Filter" boxes too, so read all of them: the hand-off must fill one with the path, and none may
    // contain query values.
    const filterTexts = () => devtools.evaluate(`(() => {
      const out = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll("[aria-label='Filter']")) out.push((el.isContentEditable ? el.textContent : (el.value ?? "")).trim());
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(document);
      return out;
    })()`);
    await waitFor(async () => (await filterTexts()).includes("/api/data"), 10_000);
    const filters = await filterTexts();
    console.log(`Filter boxes after hand-off: ${JSON.stringify(filters)}`);
    assert.ok(filters.includes("/api/data"), "the Network filter receives the URL path");
    assert.ok(filters.every((f) => !f.includes("SECRET") && !f.includes("access_token")), "no query values reach any filter");
  }

  console.log(`Real DevTools: ${shown.length} requests match getHAR; counts ${JSON.stringify(state.counts)}.`);
  console.log("Integration checks passed.");
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await ctx.close();
  server.kill();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
