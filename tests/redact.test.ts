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

test("allowlisted harmless parameters are kept; order and encoding are preserved", () => {
  const url = "https://shop.test/search?page=2&sort=price&lang=en&format=json#reviews";
  assert.deepEqual(redactUrl(url), { url, redactions: 0 });
  const mixed = redactUrl("https://shop.test/a?page=1&session=SUPERSECRET&sort=asc");
  assert.equal(mixed.url, `https://shop.test/a?page=1&session=${REDACTED}&sort=asc`);
});

test("values are hidden by default unless the name is allowlisted and the value is plain", () => {
  // Free text, IDs and unknown names are hidden: they may carry personal data or secrets.
  assert.equal(redactUrl("https://shop.test/search?q=red%20shoes&page=2").url, `https://shop.test/search?q=${REDACTED}&page=2`);
  assert.equal(redactUrl("https://a.test/api?id=12345&limit=10").url, `https://a.test/api?id=${REDACTED}&limit=10`);
  // An allowlisted name with a secret-looking or non-plain value is still hidden.
  assert.equal(redactUrl("https://a.test/api?page=jane%40example.com").url, `https://a.test/api?page=${REDACTED}`);
  assert.equal(redactUrl("https://a.test/api?view=" + "a1".repeat(20)).url, `https://a.test/api?view=${REDACTED}`);
  // Empty values have nothing to hide.
  assert.equal(redactUrl("https://a.test/api?flag=&page=1").redactions, 0);
});

test("redaction never mutates the captured value", () => {
  const original = "https://api.test/v1?access_token=abc";
  const captured = { url: original };
  redactUrl(captured.url);
  assert.equal(captured.url, original);
});

test("short password names and email addresses are redacted (release audit)", () => {
  assert.equal(redactUrl("https://a.test/api?pw=hunter2&page=1").url, `https://a.test/api?pw=${REDACTED}&page=1`);
  assert.equal(redactUrl("https://a.test/u/jane.doe@example.com/profile").url, `https://a.test/u/${REDACTED}/profile`);
  assert.equal(redactUrl("https://a.test/api?to=jane%40example.com&page=1").url, `https://a.test/api?to=${REDACTED}&page=1`);
  // A short secret under a meaningless name cannot be recognised by patterns, so default-deny hides it.
  assert.equal(redactUrl("https://a.test/api?t=abc123").url, `https://a.test/api?t=${REDACTED}`);
  assert.equal(redactUrl("https://a.test/#t=abc123").url, `https://a.test/#t=${REDACTED}`);
});
