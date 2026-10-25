// Bridges chrome.devtools.network to the RequestStore.
//
// Measured in Chrome: onRequestFinished does not fire for every request (for
// example, fetches whose response body the page never reads), while getHAR
// lists them. So getHAR, which mirrors the native Network log, is the source of
// truth; onRequestFinished is only the fast path. getHAR also lists requests
// still in flight (status 0, no error); those are skipped until they finish so
// they are never shown as failures.
import { isUnfinished } from "./model.js";
import type { RequestStore } from "./store.js";

/** The subset of chrome.devtools.network we use; injectable for tests. */
export interface NetworkApi {
  getHAR(callback: (log: { entries?: unknown[] } | undefined) => void): void;
  onRequestFinished: { addListener(cb: (request: unknown) => void): void };
  onNavigated: { addListener(cb: (url: string) => void): void };
}

export interface CaptureOptions {
  /** Delay before reconciling after an event, in ms. */
  debounceMs?: number;
  /** Minimum interval between background reconciles, in ms. */
  pollMs?: number;
  /** Background polling pauses while this returns false (e.g. hidden panel). */
  isActive?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

export interface Capture {
  /** Fetch the HAR log now and add any finished requests not yet seen. */
  reconcile(): void;
  stop(): void;
}

export function startCapture(store: RequestStore, api: NetworkApi, options: CaptureOptions = {}): Capture {
  const debounceMs = options.debounceMs ?? 300;
  const pollMs = options.pollMs ?? 2000;
  const isActive = options.isActive ?? (() => true);
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = options.now ?? (() => performance.now());

  let inFlight = false;
  let again = false;
  let stopped = false;
  let lastCost = 0;
  let debounceTimer: unknown;
  let pollTimer: unknown;

  function reconcile(): void {
    if (stopped) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const generation = store.generation;
    const started = now();
    api.getHAR((log) => {
      inFlight = false;
      lastCost = now() - started;
      // A navigation or Clear while getHAR was running makes this answer stale.
      if (generation === store.generation && !stopped) {
        const entries = Array.isArray(log?.entries) ? log.entries : [];
        store.applyLogOrder(entries);
        store.add(entries.filter((e) => !isUnfinished(e)));
      }
      if (again) {
        again = false;
        reconcile();
      }
    });
  }

  function soon(): void {
    clearTimer(debounceTimer);
    debounceTimer = setTimer(reconcile, debounceMs);
  }

  function schedulePoll(): void {
    // Back off on large logs: never spend more than ~5% of the time in getHAR.
    pollTimer = setTimer(() => {
      if (isActive()) reconcile();
      if (!stopped) schedulePoll();
    }, Math.max(pollMs, lastCost * 20));
  }

  api.onRequestFinished.addListener((request) => {
    store.add([request]);
    soon();
  });
  api.onNavigated.addListener(() => {
    store.navigated();
    soon();
  });

  reconcile();
  schedulePoll();

  return {
    reconcile,
    stop() {
      stopped = true;
      clearTimer(debounceTimer);
      clearTimer(pollTimer);
    },
  };
}
