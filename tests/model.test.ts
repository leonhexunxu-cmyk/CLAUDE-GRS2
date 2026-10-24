import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOutcome, describeOutcome, normalizeEntry, SLOW_THRESHOLD_MS } from "../src/model.js";
import { harEntry } from "./fixtures.js";

test("normalizes a complete successful entry", () => {
  const r = normalizeEntry(harEntry(), 1);
  assert.equal(r.method, "GET");
  assert.equal(r.status, 200);
  assert.equal(r.outcome, "success");
  assert.equal(r.name, "items");
  assert.equal(r.host, "example.test");
  assert.equal(r.resourceType, "fetch");
  assert.equal(r.resourceTypeSource, "devtools");
  assert.equal(r.durationMs, 42);
  assert.equal(r.transferSize, 300);
  assert.equal(r.slow, false);
});

test("HAR -1 timings become null, never zero", () => {
  const r = normalizeEntry(harEntry(), 1);
  assert.equal(r.timings.dns, null);
  assert.equal(r.timings.connect, null);
  assert.equal(r.timings.ssl, null);
  assert.equal(r.timings.wait, 30);
  assert.equal(r.timings.send, 0.2);
});

test("missing values stay null instead of being invented", () => {
  const r = normalizeEntry({ request: { url: "https://a.test/" } }, 7);
  assert.equal(r.method, null);
  assert.equal(r.status, null);
  assert.equal(r.durationMs, null);
  assert.equal(r.startedAt, null);
  assert.equal(r.transferSize, null);
  assert.equal(r.resourceType, "unknown");
  assert.equal(r.resourceTypeSource, "unknown");
  assert.equal(r.slow, false);
  for (const v of Object.values(r.timings)) assert.equal(v, null);
});

test("malformed input does not throw", () => {
  for (const raw of [null, undefined, 42, "x", [], { request: null, response: "bad", timings: 5 }]) {
    const r = normalizeEntry(raw, 1);
    assert.equal(r.url, null);
    assert.equal(r.outcome, "failed");
    assert.equal(r.name, "(no URL)");
  }
});

test("status 0 with a Chrome error is a failure with no status", () => {
  const r = normalizeEntry(harEntry({ status: 0, statusText: "", error: "net::ERR_CONNECTION_REFUSED" }), 1);
  assert.equal(r.status, null);
  assert.equal(r.outcome, "failed");
  assert.equal(r.errorText, "net::ERR_CONNECTION_REFUSED");
  assert.match(describeOutcome(r), /ERR_CONNECTION_REFUSED/);
});

test("status 0 without a reason does not claim one", () => {
  const r = normalizeEntry(harEntry({ status: 0, statusText: "" }), 1);
  assert.equal(r.outcome, "failed");
  assert.match(describeOutcome(r), /did not report a reason/);
});

test("classifies outcomes", () => {
  assert.equal(classifyOutcome(204), "success");
  assert.equal(classifyOutcome(304), "success");
  assert.equal(classifyOutcome(301), "redirect");
  assert.equal(classifyOutcome(308), "redirect");
  assert.equal(classifyOutcome(300), "other");
  assert.equal(classifyOutcome(101), "other");
  assert.equal(classifyOutcome(404), "http-error");
  assert.equal(classifyOutcome(503), "http-error");
  assert.equal(classifyOutcome(0), "failed");
  assert.equal(classifyOutcome(null), "failed");
});

test("HTTP errors are described as responses, not confirmed defects", () => {
  const notFound = describeOutcome(normalizeEntry(harEntry({ status: 404, statusText: "Not Found" }), 1));
  assert.match(notFound, /can be expected behaviour/);
  assert.doesNotMatch(notFound, /\bbug\b|\bdefect\b/i);
});

test("redirects keep their target", () => {
  const r = normalizeEntry(harEntry({ status: 302, statusText: "Found", redirectURL: "https://example.test/login" }), 1);
  assert.equal(r.outcome, "redirect");
  assert.equal(r.redirectTo, "https://example.test/login");
});

test("aborted response keeps its status and error text", () => {
  const r = normalizeEntry(harEntry({ status: 200, error: "net::ERR_ABORTED" }), 1);
  assert.equal(r.outcome, "success");
  assert.equal(r.errorText, "net::ERR_ABORTED");
});

test("slow flag uses the threshold", () => {
  assert.equal(normalizeEntry(harEntry({ time: SLOW_THRESHOLD_MS }), 1).slow, true);
  assert.equal(normalizeEntry(harEntry({ time: SLOW_THRESHOLD_MS - 1 }), 1).slow, false);
});

test("resource type falls back to MIME inference and says so", () => {
  const raw = harEntry({ mime: "text/css" });
  delete raw._resourceType;
  const r = normalizeEntry(raw, 1);
  assert.equal(r.resourceType, "stylesheet");
  assert.equal(r.resourceTypeSource, "mime");
});

test("display names handle roots, encoding and data URLs", () => {
  assert.equal(normalizeEntry(harEntry({ url: "https://example.test/" }), 1).name, "example.test");
  assert.equal(normalizeEntry(harEntry({ url: "https://example.test/a%20b.js" }), 1).name, "a b.js");
  assert.equal(normalizeEntry(harEntry({ url: "https://example.test/bad%E0%A4%A" }), 1).name, "bad%E0%A4%A");
  assert.ok(normalizeEntry(harEntry({ url: "data:image/png;base64," + "A".repeat(100) }), 1).name.endsWith("…"));
});
