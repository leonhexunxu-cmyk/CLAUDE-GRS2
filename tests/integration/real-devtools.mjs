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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ext = join(root, "dist");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pagePort = 8790 + Math.floor(Math.random() * 100);
const debugPort = 9300 + Math.floor(Math.random() * 100);

const server = spawn(process.execPath, [join(root, "test-pages/server.mjs"), String(pagePort)], { stdio: "ignore" });
const profile = mkdtempSync(join(tmpdir(), "quick-debug-"));
const ctx = await chromium.launchPersistentContext(profile, {
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

let failed = false;
try {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const base = `http://127.0.0.1:${pagePort}`;
  for (let i = 0; i < 20; i++) { try { await fetch(base); break; } catch { await sleep(100); } }
  await page.goto(base + "/");
  await sleep(2500);

  const devtools = await connect((t) => t.url.startsWith("devtools://"));
  const opened = await devtools.evaluate(`(async () => {
    const UI = await import("./ui/legacy/legacy.js");
    const view = UI.InspectorView.InspectorView.instance();
    const id = view.tabbedPane.tabIds().find((x) => x.endsWith("QuickDebug"));
    if (!id) return null;
    await view.showPanel(id);
    return id;
  })()`);
  assert.ok(opened, "Quick Debug panel registered in DevTools");
  const panel = await connect((t) => t.url.endsWith("/panel.html"));
  await sleep(500);

  // Opened after the page loaded: the panel backfills from getHAR and says capture may be partial.
  const first = await panel.evaluate(`({ rows: document.querySelectorAll("#rows tr").length, notice: !document.getElementById("notice").hidden })`);
  assert.equal(first.notice, true, "partial-capture notice shown before a navigation");
  assert.ok(first.rows > 0, "backfilled requests from before the panel opened");

  await page.reload();
  await sleep(4500); // the page's fetches include a 1.5 s response

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
    assert.equal(row.title, e.url, `row ${i} URL`);
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
    return { outcome: document.getElementById("d-outcome").textContent, meaning: document.getElementById("d-meaning").textContent,
             report: document.getElementById("d-report").textContent };
  })()`);
  const data = await pick("access_token");
  assert.ok(!data.report.includes("SECRET-TOKEN-123"), "token redacted in report");
  assert.match(data.report, /access_token=\[REDACTED\]/);
  assert.match(data.report, /Capture: recorded since the last page navigation/);
  assert.match((await pick("/drop")).meaning, /net::ERR_EMPTY_RESPONSE/);
  assert.match((await pick("/blocked-port")).meaning, /Chrome reported: net::ERR_UNSAFE_PORT/);
  assert.match((await pick("/api/unauthorized")).meaning, /can be expected behaviour/);
  assert.match((await pick("/slow")).report, /Duration:\s+1\.\d\d s \(slow\)/);

  // Hand-off to the native Network panel.
  await pick("/api/error");
  if (process.env.SCREENSHOT) {
    const shot = await devtools.send("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(process.env.SCREENSHOT, Buffer.from(shot.result.data, "base64"));
  }
  const hasButton = await panel.evaluate(`!document.getElementById("open-network").hidden`);
  if (hasButton) {
    await panel.evaluate(`document.getElementById("open-network").click()`);
    await sleep(500);
    const selected = await devtools.evaluate(`(async () => (await import("./ui/legacy/legacy.js")).InspectorView.InspectorView.instance().tabbedPane.selectedTabId)()`);
    assert.equal(selected, "network", "Show in Network panel switches to the native Network panel");
  } else {
    console.log("Note: this Chrome has no chrome.devtools.panels.network.show; the button is hidden.");
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
