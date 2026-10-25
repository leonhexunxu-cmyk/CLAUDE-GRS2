import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Tests run from build-test/tests; the repository root is two levels up from there.
const root = join(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));

function pngSize(path: string): [number, number] {
  const buf = readFileSync(path);
  assert.equal(buf.toString("ascii", 1, 4), "PNG", `${path} is a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test("manifest is MV3 with no permissions and a no-network CSP", () => {
  assert.equal(manifest.manifest_version, 3);
  for (const key of ["permissions", "host_permissions", "optional_permissions", "content_scripts", "background"]) assert.equal(manifest[key], undefined, key);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
});

test("every declared icon exists at its declared size", () => {
  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "32", "48"]);
  for (const [size, file] of Object.entries(manifest.icons as Record<string, string>)) {
    const path = join(root, "extension", file);
    assert.ok(existsSync(path), file);
    assert.deepEqual(pngSize(path), [Number(size), Number(size)], file);
  }
});
