import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/report.js";
import { normalizeEntry } from "../src/model.js";
import { harEntry } from "./fixtures.js";

test("report includes key facts and redacts the URL", () => {
  const req = normalizeEntry(harEntry({ url: "https://api.test/orders?session=s3cr3t&page=1", status: 500, statusText: "Internal Server Error" }), 1);
  const text = buildReport(req, { capture: "complete" });
  assert.match(text, /GET https:\/\/api\.test\/orders\?session=\[REDACTED\]&page=1/);
  assert.match(text, /HTTP error \(500 Internal Server Error\)/);
  assert.match(text, /dns n\/a/);
  assert.match(text, /wait 30 ms/);
  assert.match(text, /1 sensitive URL value/);
  assert.ok(!text.includes("s3cr3t"));
});

test("report states partial capture and missing values honestly", () => {
  const req = normalizeEntry({ request: { url: "https://a.test/x" } }, 1);
  const text = buildReport(req, { capture: "partial" });
  assert.match(text, /Capture: partial/);
  assert.match(text, /Duration:\s+n\/a/);
  assert.match(text, /\(method n\/a\)/);
  assert.match(text, /Outcome:\s+No response \(no status\)/);
});

test("redirect targets are redacted too", () => {
  const req = normalizeEntry(harEntry({ status: 302, redirectURL: "https://a.test/cb?code=xyz" }), 1);
  const text = buildReport(req, { capture: "complete" });
  assert.match(text, /Redirect:\s+https:\/\/a\.test\/cb\?code=\[REDACTED\]/);
});
