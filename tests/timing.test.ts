import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEntry } from "../src/model.js";
import { analyze } from "../src/explain.js";
import { buildReport } from "../src/report.js";
import { harEntry } from "./fixtures.js";

// Values copied from a real Chrome 153 getHAR entry for the test page's /slow route.
const realSlow = {
  startedDateTime: "2026-10-24T12:20:20.000Z",
  time: 1504.19,
  request: { method: "GET", url: "http://127.0.0.1:8825/slow" },
  response: { status: 200, statusText: "OK", content: { mimeType: "application/json" } },
  timings: { blocked: 0.67, dns: -1, ssl: -1, connect: -1, send: 0.459, wait: 1500.996, receive: 2.07, _blocked_queueing: 0.468 },
  _resourceType: "fetch",
};

test("valid record: phases (excluding ssl) add up to the total", () => {
  const r = normalizeEntry(realSlow, 1);
  assert.equal(r.timingCheck.consistent, true);
  assert.ok(Math.abs((r.timingCheck.phaseSum ?? 0) - 1504.19) < 0.01);
  assert.equal(r.queueingMs, 0.468);
  const why = analyze(r).find((f) => f.kind === "timing");
  assert.ok(why);
  assert.match(why.detail, /first byte/);
  assert.match(why.detail, /100%|99%/);
});

test("ssl is not double counted: it is part of connect (HAR 1.2)", () => {
  const r = normalizeEntry(harEntry({ time: 60, timings: { blocked: 0, dns: 5, connect: 30, ssl: 20, send: 1, wait: 20, receive: 4 } }), 1);
  assert.equal(r.timingCheck.phaseSum, 60);
  assert.equal(r.timingCheck.consistent, true);
});

test("the reviewed 24 ms / 25 ms wait case is flagged, not hidden or 'fixed'", () => {
  // The values from the first UI screenshot (they came from mock data, not Chrome).
  const r = normalizeEntry(harEntry({ time: 24, timings: { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 0.1, wait: 25, receive: 3 } }), 1);
  assert.equal(r.durationMs, 24);
  assert.equal(r.timings.wait, 25);
  assert.equal(r.timingCheck.consistent, false);
  const note = analyze(r).find((f) => f.title === "Timing data is inconsistent");
  assert.ok(note);
  assert.match(note.detail, /24 ms.*29 ms/);
  assert.match(buildReport(r, { capture: "complete" }), /Timing data is inconsistent/);
});

test("missing timings stay unknown; no sum, no consistency claim", () => {
  const r = normalizeEntry({ request: { url: "https://a.test/x" }, response: { status: 200 } }, 1);
  assert.equal(r.durationMs, null);
  assert.equal(r.timingCheck.phaseSum, null);
  assert.equal(r.timingCheck.consistent, null);
  assert.equal(analyze(r).some((f) => f.kind === "timing"), false);
  const partial = normalizeEntry(harEntry({ time: 50, timings: { wait: 40 } }), 2);
  assert.equal(partial.timings.receive, null);
  assert.equal(partial.timingCheck.consistent, false);
});

test("failed request: Chrome's zero phases are explained as not reached", () => {
  // Real Chrome shape for a dropped connection.
  const r = normalizeEntry({
    startedDateTime: "2026-10-24T12:20:21.000Z", time: 4.56,
    request: { method: "GET", url: "http://127.0.0.1:8825/drop" },
    response: { status: 0, statusText: "", _error: "net::ERR_EMPTY_RESPONSE" },
    timings: { blocked: 4.556, dns: -1, ssl: -1, connect: -1, send: 0, wait: 0, receive: 0, _blocked_queueing: 0.827 },
    _resourceType: "fetch",
  }, 1);
  assert.equal(r.outcome, "failed");
  assert.equal(r.timingCheck.consistent, true);
  const findings = analyze(r);
  assert.ok(findings.some((f) => f.title === "No response phases"));
  assert.ok(findings.some((f) => f.title.startsWith("Likely source: The server")));
  assert.equal(findings.some((f) => f.kind === "timing"), false, "no 'why slow' analysis for a request that never got a response");
});

test("redirect records keep their own timing", () => {
  const r = normalizeEntry(harEntry({ status: 302, redirectURL: "https://a.test/new", time: 2.95, timings: { blocked: 0.643, send: 0.065, wait: 1.867, receive: 0.375 } }), 1);
  assert.equal(r.outcome, "redirect");
  assert.equal(r.timingCheck.consistent, true);
});
