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

test("headers, cookies, auth and bodies present in the HAR never reach any report", async () => {
  const { buildTechnicalReport } = await import("../src/report.js");
  const raw = harEntry({ url: "https://api.test/me?session=SUPERSECRET" }) as Record<string, any>;
  raw.request.headers = [{ name: "Authorization", value: "Bearer AUTHSECRET" }, { name: "Cookie", value: "sid=COOKIESECRET" }];
  raw.request.cookies = [{ name: "sid", value: "COOKIESECRET" }];
  raw.request.postData = { mimeType: "application/json", text: "{\"password\":\"BODYSECRET\"}" };
  raw.response.headers = [{ name: "Set-Cookie", value: "sid=COOKIESECRET" }];
  raw.response.content.text = "RESPONSEBODYSECRET";
  const req = normalizeEntry(raw, 1);
  const outputs = [
    buildReport(req, { capture: "complete" }),
    buildTechnicalReport([req], { capture: "complete", generatedAt: new Date(0), scope: "selected request" }, "md").content,
    buildTechnicalReport([req, req], { capture: "complete", generatedAt: new Date(0), scope: "all visible" }, "json").content,
  ];
  for (const out of outputs) {
    for (const secret of ["SUPERSECRET", "AUTHSECRET", "COOKIESECRET", "BODYSECRET", "RESPONSEBODYSECRET", "Authorization", "Set-Cookie"]) {
      assert.ok(!out.includes(secret), `${secret} leaked`);
    }
  }
});

test("technical reports: names, formats and problem detail", async () => {
  const { buildTechnicalReport } = await import("../src/report.js");
  const reqs = [
    normalizeEntry(harEntry({ url: "https://a.test/ok", started: "2026-10-24T12:00:00.000Z" }), 1),
    normalizeEntry(harEntry({ url: "https://a.test/boom", status: 500, statusText: "Internal Server Error", started: "2026-10-24T12:00:01.000Z" }), 2),
  ];
  const ctx = { capture: "partial" as const, generatedAt: new Date("2026-10-24T12:00:00Z"), scope: "all visible (2)" };
  const md = buildTechnicalReport(reqs, ctx, "md");
  assert.equal(md.filename, "quick-debug-report-2026-10-24T12-00-00.md");
  assert.match(md.content, /\| 2 \| 1 \| 0 \| 1 \| 0 \| 0 \|/);
  assert.match(md.content, /### GET https:\/\/a\.test\/boom/);
  assert.match(md.content, /Likely source: The server/);
  assert.doesNotMatch(md.content, /### GET https:\/\/a\.test\/ok/);
  const json = JSON.parse(buildTechnicalReport(reqs, ctx, "json").content);
  assert.equal(json.requests.length, 2);
  assert.equal(json.capture, "partial");
  assert.equal(json.requests[1].statusHelp.title, "Internal Server Error");
  assert.equal(json.requests[0].timingsMs.dns, null);
});
