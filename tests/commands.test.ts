import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, pinnableText, COMMANDS } from "../src/commands.js";

const ok = (input: string) => {
  const r = parseCommand(input);
  assert.ok(r.ok, `${input}: ${!r.ok ? r.error : ""}`);
  return r.command;
};
const bad = (input: string) => {
  const r = parseCommand(input);
  assert.equal(r.ok, false, input);
  return r.ok ? "" : r.error;
};

test("valid commands and arguments", () => {
  assert.deepEqual(ok("/help"), { name: "/help", topic: null });
  assert.deepEqual(ok("/HELP spooky"), { name: "/help", topic: "/spooky" });
  assert.deepEqual(ok("/show errors"), { name: "/show", view: "http-error" });
  assert.deepEqual(ok("/filter no-response"), { name: "/show", view: "failed" });
  assert.deepEqual(ok("/type Fetch"), { name: "/type", type: "fetch" });
  assert.deepEqual(ok("/search api  cart"), { name: "/search", text: "api  cart" });
  assert.deepEqual(ok("/search"), { name: "/search", text: "" });
  assert.deepEqual(ok("/slowest"), { name: "/slowest", count: 5 });
  assert.deepEqual(ok("/slowest 20"), { name: "/slowest", count: 20 });
  assert.deepEqual(ok("/select 3"), { name: "/select", index: 3 });
  assert.deepEqual(ok("/download"), { name: "/download", format: "md", scope: "selected" });
  assert.deepEqual(ok("/download json all"), { name: "/download", format: "json", scope: "visible" });
  assert.deepEqual(ok("/explain 202"), { name: "/explain", code: "202" });
  assert.deepEqual(ok("/explain net::ERR_FAILED"), { name: "/explain", code: "net::ERR_FAILED" });
  assert.deepEqual(ok("/theme dark"), { name: "/theme", theme: "dark" });
  for (const n of ["/reset", "/copy", "/pins", "/reset-usage", "/clear", "/cls", "/spooky"]) assert.equal(ok(n).name, n);
});

test("every documented command parses", () => {
  for (const c of COMMANDS) {
    const example = { "/show": "/show all", "/type": "/type fetch", "/slowest": "/slowest", "/select": "/select 1", "/explain": "/explain 404", "/theme": "/theme auto", "/pin": "/pin /copy", "/unpin": "/unpin /copy" }[c.name as string] ?? c.name;
    ok(example);
  }
});

test("invalid commands and malformed arguments are rejected with a clear message", () => {
  assert.match(bad("/nope"), /Unknown command \/nope/);
  assert.match(bad("/sho all"), /Did you mean \/show/);
  assert.match(bad("/show everything"), /Usage: \/show/);
  assert.match(bad("/slowest 0"), /Usage/);
  assert.match(bad("/slowest 21"), /Usage/);
  assert.match(bad("/slowest -1"), /Usage/);
  assert.match(bad("/select 0"), /Usage/);
  assert.match(bad("/select 1e3"), /Usage/);
  assert.match(bad("/download pdf"), /Usage/);
  assert.match(bad("/explain 20"), /Usage/);
  assert.match(bad("/theme neon"), /Usage/);
  assert.match(bad("/copy now"), /takes no arguments/);
  assert.match(bad("/type a b"), /Usage/);
  assert.match(bad("/type <img>"), /Usage/);
  assert.match(bad(""), /Type a command/);
  assert.match(bad("/search " + "x".repeat(201)), /too long/);
  assert.match(bad("/" + "a".repeat(400)), /too long/);
  assert.match(bad("/show\u0000all"), /control characters/);
});

test("shell commands and JavaScript are refused, never interpreted", () => {
  for (const attempt of ["rm -rf /", "cmd.exe /c dir", "powershell Get-Process", "bash -c 'id'", "ls", "alert(1)", "eval('1')", "fetch('https://evil.test')", "document.cookie", "javascript:alert(1)"]) {
    assert.match(bad(attempt), /cannot run shell commands or JavaScript/, attempt);
  }
  for (const attempt of ["/eval 1+1", "/exec ls", "/bash", "/js alert(1)", "/run cmd.exe"]) assert.match(bad(attempt), /Unknown command/, attempt);
  // Arguments are data: a search containing code is just search text.
  assert.deepEqual(ok("/search alert(1)"), { name: "/search", text: "alert(1)" });
});

test("only fixed-argument commands can be pinned (no typed text is persisted)", () => {
  assert.equal(pinnableText(ok("/show errors")), "/show errors");
  assert.equal(pinnableText(ok("/download json all")), "/download json all");
  assert.equal(pinnableText(ok("/copy")), "/copy");
  assert.equal(pinnableText(ok("/search session=abc")), null);
  assert.equal(pinnableText(ok("/select 2")), null);
  assert.equal(pinnableText(ok("/pin /copy")), null);
  assert.equal(pinnableText(ok("/reset-usage")), null);
});
