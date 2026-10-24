// In-memory request store. No chrome.* calls: the capture layer feeds it raw
// HAR entries, the UI reads from it.
import { entryKey, normalizeEntry, type NormalizedRequest } from "./model.js";
import type { CaptureCompleteness } from "./report.js";

export type StoreListener = (change: StoreChange) => void;
export type StoreChange =
  /** `appended` is false when at least one request was inserted before existing ones. */
  | { kind: "added"; requests: NormalizedRequest[]; appended: boolean }
  | { kind: "reset" }
  | { kind: "capture" };

/** Order like the native Network panel: by start time; unknown start times last; ties by arrival. */
function before(a: NormalizedRequest, b: NormalizedRequest): boolean {
  const ta = a.startedMs ?? Infinity;
  const tb = b.startedMs ?? Infinity;
  return ta < tb || (ta === tb && a.id < b.id);
}

export class RequestStore {
  private items: NormalizedRequest[] = [];
  private byId = new Map<number, NormalizedRequest>();
  private keys = new Set<string>();
  private nextId = 1;
  private listeners = new Set<StoreListener>();
  /** "partial" until we observe a navigation while capturing. */
  capture: CaptureCompleteness = "partial";
  /** Changes on every clear or navigation; lets async readers detect stale results. */
  generation = 0;

  get all(): readonly NormalizedRequest[] {
    return this.items;
  }

  get(id: number): NormalizedRequest | undefined {
    return this.byId.get(id);
  }

  /** Highest id assigned so far; every later request gets a larger one. */
  get lastId(): number {
    return this.nextId - 1;
  }

  /** Add raw HAR entries; duplicates (same start time, method, URL and duration) are ignored. */
  add(entries: readonly unknown[]): NormalizedRequest[] {
    const added: NormalizedRequest[] = [];
    let appended = true;
    for (const raw of entries) {
      const key = entryKey(raw);
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      const req = normalizeEntry(raw, this.nextId++);
      // Requests usually arrive roughly in order, so scan back from the end.
      let pos = this.items.length;
      while (pos > 0 && before(req, this.items[pos - 1]!)) pos--;
      if (pos < this.items.length) appended = false;
      this.items.splice(pos, 0, req);
      this.byId.set(req.id, req);
      added.push(req);
    }
    if (added.length) this.emit({ kind: "added", requests: added, appended });
    return added;
  }

  /**
   * User-initiated clear. Keys are kept so the requests do not come back on the
   * next reconcile with the HAR log, which still contains them.
   */
  clear(): void {
    this.items = [];
    this.byId.clear();
    this.generation++;
    this.emit({ kind: "reset" });
  }

  /**
   * A navigation starts a fresh, complete capture. The HAR log is reset by
   * DevTools too (unless "Preserve log" is on, in which case old requests come
   * back from it, matching the native Network panel).
   */
  navigated(): void {
    this.items = [];
    this.byId.clear();
    this.keys.clear();
    this.generation++;
    this.capture = "complete";
    this.emit({ kind: "reset" });
    this.emit({ kind: "capture" });
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: StoreChange): void {
    for (const l of this.listeners) l(change);
  }
}
