import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilter, DEFAULT_FILTER, resourceTypes, summarize } from "../src/filter.js";
import { normalizeEntry } from "../src/model.js";
import { harEntry } from "./fixtures.js";

const requests = [
  harEntry({ url: "https://a.test/ok.js", type: "script", started: "1" }),
  harEntry({ url: "https://a.test/missing.png", status: 404, statusText: "Not Found", type: "image", started: "2" }),
  harEntry({ url: "https://a.test/api/boom", status: 500, statusText: "Internal Server Error", started: "3" }),
  harEntry({ url: "https://a.test/down", status: 0, error: "net::ERR_FAILED", started: "4" }),
  harEntry({ url: "https://a.test/old", status: 301, redirectURL: "https://a.test/new", type: "document", started: "5" }),
  harEntry({ url: "https://a.test/api/slow", time: 2500, started: "6" }),
].map((raw, i) => normalizeEntry(raw, i + 1));

const names = (list: { name: string }[]) => list.map((r) => r.name);

test("default filter shows everything", () => {
  assert.equal(applyFilter(requests, DEFAULT_FILTER).length, requests.length);
});

test("status views", () => {
  const f = (status: typeof DEFAULT_FILTER.status) => names(applyFilter(requests, { ...DEFAULT_FILTER, status }));
  assert.deepEqual(f("failed"), ["down"]);
  assert.deepEqual(f("http-error"), ["missing.png", "boom"]);
  assert.deepEqual(f("redirect"), ["old"]);
  assert.deepEqual(f("slow"), ["slow"]);
  assert.deepEqual(f("problems"), ["missing.png", "boom", "down", "slow"]);
});

test("type and text filters combine", () => {
  assert.deepEqual(names(applyFilter(requests, { ...DEFAULT_FILTER, type: "image" })), ["missing.png"]);
  assert.deepEqual(names(applyFilter(requests, { ...DEFAULT_FILTER, text: "API" })), ["boom", "slow"]);
  assert.deepEqual(names(applyFilter(requests, { ...DEFAULT_FILTER, text: "api 500" })), ["boom"]);
  assert.deepEqual(names(applyFilter(requests, { ...DEFAULT_FILTER, text: "err_failed" })), ["down"]);
  assert.deepEqual(names(applyFilter(requests, { status: "problems", type: "fetch", text: "api" })), ["boom", "slow"]);
});

test("summary and types", () => {
  assert.deepEqual(summarize(requests), { total: 6, problems: 4, failed: 1, httpErrors: 2, redirects: 1, slow: 1 });
  assert.deepEqual(resourceTypes(requests), ["document", "fetch", "image", "script"]);
});
