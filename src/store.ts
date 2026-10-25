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


export class RequestStore {
  private items: NormalizedRequest[] = [];
  private byId = new Map<number, NormalizedRequest>();
  private keys = new Set<string>();
  private keyOf = new Map<number, string>();
  /**
   * Position of each request in DevTools' own log (from getHAR). HAR start times
   * have millisecond precision, so requests started in the same millisecond tie;
   * the log position breaks the tie the way the native Network panel orders them.
   */
  private logIndex = new Map<string, number>();
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

  /** Order like the native Network panel: start time, then DevTools log position, then arrival; unknown start times last. */
  private before(a: NormalizedRequest, b: NormalizedRequest): boolean {
    const ta = a.startedMs ?? Infinity;
    const tb = b.startedMs ?? Infinity;
    if (ta !== tb) return ta < tb;
    const la = this.logIndex.get(this.keyOf.get(a.id) ?? "");
    const lb = this.logIndex.get(this.keyOf.get(b.id) ?? "");
    if (la !== undefined && lb !== undefined && la !== lb) return la < lb;
    return a.id < b.id;
  }

  /**
   * Record the order of DevTools' full request log (the entries of one getHAR
   * call, in order). Re-sorts and notifies listeners if that changes the order of
   * requests already shown.
   */
  applyLogOrder(log: readonly unknown[]): void {
    log.forEach((raw, i) => this.logIndex.set(entryKey(raw), i));
    const sorted = this.items.every((item, i) => i === 0 || !this.before(item, this.items[i - 1]!));
    if (sorted) return;
    this.items = [...this.items].sort((a, b) => (this.before(a, b) ? -1 : this.before(b, a) ? 1 : 0));
    this.emit({ kind: "added", requests: [], appended: false });
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
      this.keyOf.set(req.id, key);
      while (pos > 0 && this.before(req, this.items[pos - 1]!)) pos--;
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
    this.keyOf.clear();
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
    this.keyOf.clear();
    this.logIndex.clear();
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
