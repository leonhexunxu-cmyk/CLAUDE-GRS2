import { test } from "node:test";
import assert from "node:assert/strict";
import { redactUrl, REDACTED } from "../src/redact.js";

test("sensitive query parameters are redacted, harmless ones kept", () => {
  const r = redactUrl("https://api.test/v1/items?page=2&access_token=abc123&sort=asc&apiKey=xyz");
  assert.equal(r.url, `https://api.test/v1/items?page=2&access_token=${REDACTED}&sort=asc&apiKey=${REDACTED}`);
  assert.equal(r.redactions, 2);
});

test("credentials in the URL are removed", () => {
  const r = redactUrl("https://user:hunter2@host.test/path");
  assert.equal(r.url, "https://host.test/path");
  assert.ok(!r.url.includes("hunter2"));
});

test("opaque tokens and JWTs are redacted wherever they appear", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
  const r = redactUrl(`https://h.test/reset/${"a1b2c3d4".repeat(5)}?x=${jwt}#id_token=${jwt}&view=1`);
  assert.ok(!r.url.includes(jwt));
  assert.ok(!r.url.includes("a1b2c3d4a1b2"));
  assert.ok(r.url.includes("view=1"));
  assert.equal(r.redactions, 3);
});

test("short ordinary values and paths are untouched", () => {
  const url = "https://h.test/products/42/reviews?page=3&lang=en";
  assert.deepEqual(redactUrl(url), { url, redactions: 0 });
});

test("unparseable, missing and data URLs never pass through raw", () => {
  assert.match(redactUrl("not a url ?token=1").url, /REDACTED/);
  assert.equal(redactUrl(null).url, "(not available)");
  assert.equal(redactUrl("data:text/plain;base64,c2VjcmV0").url, "data: URL (content omitted)");
});
