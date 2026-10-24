import { test } from "node:test";
import assert from "node:assert/strict";
import { Prefs, type StorageLike } from "../src/prefs.js";

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

test("usage stores command names only, and can be reset", () => {
  const s = memory();
  const p = new Prefs(s);
  p.recordUse("/show");
  p.recordUse("/show");
  p.recordUse("/copy");
  p.recordUse("/search secret-token"); // not a bare name: ignored
  assert.deepEqual(p.usage, { "/show": 2, "/copy": 1 });
  assert.deepEqual(p.topCommands(2), ["/show", "/copy"]);
  assert.ok(![...s.data.values()].join().includes("secret"));
  p.resetUsage();
  assert.deepEqual(p.usage, {});
});

test("corrupt or hostile storage is ignored", () => {
  const s = memory();
  s.data.set("qd.theme", "\"neon\"");
  s.data.set("qd.pins", "{not json");
  s.data.set("qd.usage", JSON.stringify({ "/show": 3, "<img>": 9, "/copy": "x" }));
  const p = new Prefs(s);
  assert.equal(p.theme, "auto");
  assert.deepEqual(p.pins, []);
  assert.deepEqual(p.usage, { "/show": 3 });
});

test("works without storage (private window, blocked storage)", () => {
  const p = new Prefs(null);
  p.setTheme("dark");
  p.recordUse("/show");
  assert.equal(p.theme, "auto");
  assert.deepEqual(p.usage, {});
  const throwing: StorageLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  const q = new Prefs(throwing);
  q.setPins(["/copy"]);
  q.resetUsage();
  assert.deepEqual(q.pins, []);
});
