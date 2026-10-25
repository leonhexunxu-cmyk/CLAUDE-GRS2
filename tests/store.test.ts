import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestStore } from "../src/store.js";
import { startCapture, type NetworkApi } from "../src/capture.js";
import { isUnfinished } from "../src/model.js";
import { harEntry } from "./fixtures.js";

/** Fake chrome.devtools.network with a mutable HAR log, manual getHAR replies and manual timers. */
function fakeNetwork() {
  const finished: Array<(r: unknown) => void> = [];
  const navigated: Array<(u: string) => void> = [];
  const harReplies: Array<() => void> = [];
  let timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  let nextTimer = 1;
  const net = {
    log: [] as unknown[],
    api: {
      getHAR: (cb) => {
        const snapshot = [...net.log];
        harReplies.push(() => cb({ entries: snapshot }));
      },
      onRequestFinished: { addListener: (cb) => finished.push(cb) },
      onNavigated: { addListener: (cb) => navigated.push(cb) },
    } as NetworkApi,
    finish: (r: unknown) => finished.forEach((cb) => cb(r)),
    navigate: () => navigated.forEach((cb) => cb("https://a.test/")),
    /** Answer every pending getHAR call. */
    answerHar: () => harReplies.splice(0).forEach((reply) => reply()),
    pendingHar: () => harReplies.length,
    /** Run all timers due (they are run in order regardless of delay). */
    runTimers: () => {
      const due = timers;
      timers = [];
      due.forEach((t) => t.fn());
    },
    timerOptions: {
      setTimer: (fn: () => void, ms: number) => {
        const id = nextTimer++;
        timers.push({ fn, ms, id });
        return id;
      },
      clearTimer: (id: unknown) => {
        timers = timers.filter((t) => t.id !== id);
      },
      now: () => 0,
    },
  };
  return net;
}

const a = harEntry({ url: "https://a.test/a", started: "2026-10-24T12:00:01.000Z" });
const b = harEntry({ url: "https://a.test/b", started: "2026-10-24T12:00:02.000Z" });
const c = harEntry({ url: "https://a.test/c", started: "2026-10-24T12:00:03.000Z" });
const names = (store: RequestStore) => store.all.map((r) => r.name);

test("initial backfill plus live events, without duplicates", () => {
  const store = new RequestStore();
  const net = fakeNetwork();
  net.log = [a, b];
  startCapture(store, net.api, net.timerOptions);
  net.finish(b); // arrives before getHAR answers, and is also in the HAR
  net.answerHar();
  net.finish(c);
  net.finish(c);
  assert.deepEqual(names(store), ["a", "b", "c"]);
});

test("reconcile picks up requests that never fire onRequestFinished", () => {
  const store = new RequestStore();
  const net = fakeNetwork();
  startCapture(store, net.api, net.timerOptions);
  net.answerHar();
  net.log = [a, b]; // b never fires the live event (as with unread fetch bodies in Chrome)
  net.finish(a);
  net.runTimers(); // debounce + poll
  net.answerHar();
  assert.deepEqual(names(store), ["a", "b"]);
});

test("in-flight HAR entries are not shown as failures", () => {
  const pending = harEntry({ url: "https://a.test/slow", status: 0, statusText: "", time: 0, started: "2026-10-24T12:00:04.000Z" });
  const refused = harEntry({ url: "https://a.test/refused", status: 0, error: "net::ERR_CONNECTION_REFUSED", started: "2026-10-24T12:00:05.000Z" });
  assert.equal(isUnfinished(pending), true);
  assert.equal(isUnfinished(refused), false);
  assert.equal(isUnfinished(a), false);

  const store = new RequestStore();
  const net = fakeNetwork();
  net.log = [pending, refused];
  startCapture(store, net.api, net.timerOptions);
  net.answerHar();
  assert.deepEqual(names(store), ["refused"]);

  net.log = [harEntry({ url: "https://a.test/slow", time: 1500, started: "2026-10-24T12:00:04.000Z" }), refused];
  net.runTimers();
  net.answerHar();
  assert.deepEqual(names(store), ["slow", "refused"]);
  assert.equal(store.all[0]?.outcome, "success");
});

test("a getHAR reply that straddles a navigation is discarded", () => {
  const store = new RequestStore();
  const net = fakeNetwork();
  net.log = [a, b];
  startCapture(store, net.api, net.timerOptions);
  net.navigate();
  net.answerHar(); // old page's log: stale
  assert.deepEqual(names(store), []);
  assert.equal(store.capture, "complete");
  net.log = [c];
  net.runTimers();
  net.answerHar();
  assert.deepEqual(names(store), ["c"]);
});

test("Clear hides current requests even though the HAR log still has them", () => {
  const store = new RequestStore();
  const net = fakeNetwork();
  net.log = [a];
  startCapture(store, net.api, net.timerOptions);
  net.answerHar();
  store.clear();
  net.log = [a, b];
  net.runTimers();
  net.answerHar();
  assert.deepEqual(names(store), ["b"]);
});

test("only one getHAR runs at a time; a request during one queues another", () => {
  const store = new RequestStore();
  const net = fakeNetwork();
  const capture = startCapture(store, net.api, net.timerOptions);
  capture.reconcile();
  capture.reconcile();
  assert.equal(net.pendingHar(), 1);
  net.answerHar();
  assert.equal(net.pendingHar(), 1);
  net.answerHar();
  assert.equal(net.pendingHar(), 0);
});

test("polling pauses while inactive and stops on stop()", () => {
  const store = new RequestStore();
  const net = fakeNetwork();
  let active = false;
  const capture = startCapture(store, net.api, { ...net.timerOptions, isActive: () => active });
  net.answerHar();
  net.runTimers();
  assert.equal(net.pendingHar(), 0);
  active = true;
  net.runTimers();
  assert.equal(net.pendingHar(), 1);
  net.answerHar();
  capture.stop();
  net.runTimers();
  assert.equal(net.pendingHar(), 0);
});

test("get finds by id; ids keep increasing", () => {
  const store = new RequestStore();
  store.add([harEntry({ started: "1" }), harEntry({ started: "2" })]);
  assert.equal(store.get(2)?.startedAt, "2");
  assert.equal(store.get(99), undefined);
  store.navigated();
  const [next] = store.add([harEntry({ started: "1" })]);
  assert.equal(next?.id, 3);
});

test("listeners receive added batches and resets", () => {
  const store = new RequestStore();
  const kinds: string[] = [];
  store.subscribe((change) => kinds.push(change.kind));
  store.add([harEntry()]);
  store.add([harEntry()]); // duplicate: no event
  store.clear();
  assert.deepEqual(kinds, ["added", "reset"]);
});

test("requests are ordered by start time, like the native Network panel", () => {
  const store = new RequestStore();
  const events: boolean[] = [];
  store.subscribe((change) => change.kind === "added" && events.push(change.appended));
  store.add([harEntry({ url: "https://a.test/1", started: "2026-10-24T12:00:01.000Z" })]);
  store.add([harEntry({ url: "https://a.test/3", started: "2026-10-24T12:00:03.000Z" })]);
  store.add([harEntry({ url: "https://a.test/2", started: "2026-10-24T12:00:02.000Z" })]);
  store.add([{ request: { url: "https://a.test/no-time" } }]);
  store.add([harEntry({ url: "https://a.test/4", started: "2026-10-24T12:00:04.000Z" })]);
  assert.deepEqual(names(store), ["1", "2", "3", "4", "no-time"]);
  assert.deepEqual(events, [true, true, false, true, false]);
  assert.equal(store.get(3)?.name, "2");
});

test("same-millisecond ties follow DevTools' log order, as in the native Network panel", () => {
  const t = "2026-10-24T12:00:00.124Z";
  const css = harEntry({ url: "https://a.test/style.css", started: t, time: 8 });
  const png = harEntry({ url: "https://a.test/missing.png", started: t, time: 12 });
  const js = harEntry({ url: "https://a.test/app.js", started: t, time: 16 });
  const store = new RequestStore();
  let reorders = 0;
  store.subscribe((c) => c.kind === "added" && c.requests.length === 0 && !c.appended && reorders++);
  // Live events arrive in finish order (fastest first), which is not the issue order for the slow one.
  store.add([css]);
  store.add([js]);
  store.add([png]);
  assert.deepEqual(names(store), ["style.css", "app.js", "missing.png"]);
  // getHAR returns the log in issue order: css, png, js.
  store.applyLogOrder([css, png, js]);
  assert.deepEqual(names(store), ["style.css", "missing.png", "app.js"]);
  assert.equal(reorders, 1);
  store.applyLogOrder([css, png, js]);
  assert.equal(reorders, 1, "no event when the order is already right");
  // Different start times still win over log position.
  store.add([harEntry({ url: "https://a.test/early", started: "2026-10-24T12:00:00.100Z" })]);
  assert.equal(names(store)[0], "early");
});

test("reconcile applies the log order through startCapture", () => {
  const t = "2026-10-24T12:00:00.124Z";
  const a1 = harEntry({ url: "https://a.test/one", started: t, time: 30 });
  const a2 = harEntry({ url: "https://a.test/two", started: t, time: 5 });
  const store = new RequestStore();
  const net = fakeNetwork();
  startCapture(store, net.api, net.timerOptions);
  net.answerHar();
  net.finish(a2); // finishes first
  net.finish(a1);
  assert.deepEqual(names(store), ["two", "one"]);
  net.log = [a1, a2];
  net.runTimers();
  net.answerHar();
  assert.deepEqual(names(store), ["one", "two"]);
});
