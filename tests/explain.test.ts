import { test } from "node:test";
import assert from "node:assert/strict";
import { explainCode, analyze, likelySource } from "../src/explain.js";
import { normalizeEntry } from "../src/model.js";
import { harEntry } from "./fixtures.js";

test("explains 202 as not an error", () => {
  const h = explainCode("202");
  assert.ok(h);
  assert.equal(h.title, "Accepted");
  assert.match(h.check, /Not an error/);
  assert.equal(h.reference, "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/202");
});

test("unknown but valid codes fall back to their class and say so", () => {
  const h = explainCode("299");
  assert.ok(h);
  assert.match(h.title, /not a standard code/);
  assert.equal(h.reference, undefined);
});

test("Chrome network errors, with or without the net:: prefix", () => {
  assert.equal(explainCode("net::ERR_NAME_NOT_RESOLVED")?.title, "DNS (host name lookup)");
  assert.equal(explainCode("err_blocked_by_client")?.code, "net::ERR_BLOCKED_BY_CLIENT");
  assert.match(explainCode("net::ERR_CERT_DATE_INVALID")?.meaning ?? "", /certificate/);
});

test("malformed or unknown input returns null instead of guessing", () => {
  for (const x of ["", "20", "2020", "600", "abc", "net::ERR_SOMETHING_NEW", "<script>", "rm -rf /"]) assert.equal(explainCode(x), null, x);
});

test("likely source follows the reported data", () => {
  assert.equal(likelySource(normalizeEntry(harEntry({ status: 404 }), 1)), "request");
  assert.equal(likelySource(normalizeEntry(harEntry({ status: 502 }), 1)), "server");
  assert.equal(likelySource(normalizeEntry(harEntry({ status: 0, error: "net::ERR_BLOCKED_BY_CLIENT" }), 1)), "browser");
  assert.equal(likelySource(normalizeEntry(harEntry({ status: 0 }), 1)), "unknown");
  assert.equal(likelySource(normalizeEntry(harEntry({ status: 200 }), 1)), null);
});

test("initiator is reported with a masked URL and 1-based line", () => {
  const raw = harEntry();
  raw._initiator = {
    type: "script",
    stack: { callFrames: [{ functionName: "loadCart", url: "https://a.test/app.js?token=abc123", lineNumber: 41, columnNumber: 3 }] },
  };
  const r = normalizeEntry(raw, 1);
  const f = analyze(r).find((x) => x.kind === "initiator");
  assert.ok(f);
  assert.equal(f.title, "Started by a script");
  assert.equal(f.detail, "loadCart in https://a.test/app.js?token=[REDACTED]:42");
  assert.equal(r.initiator?.url, "https://a.test/app.js?token=abc123", "the captured value itself is not modified");
});
