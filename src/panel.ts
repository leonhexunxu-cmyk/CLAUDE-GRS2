// Quick Debug panel UI. Plain DOM, no framework.
import { RequestStore } from "./store.js";
import { startCapture, type NetworkApi } from "./capture.js";
import { DEFAULT_FILTER, applyFilter, matches, resourceTypes, summarize, type FilterState, type StatusView } from "./filter.js";
import { TIMING_PHASES, describeOutcome, type NormalizedRequest, type TimingPhase } from "./model.js";
import { OUTCOME_LABEL, formatBytes, formatMs, statusCell, statusLine } from "./format.js";
import { buildReport } from "./report.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  search: $<HTMLInputElement>("search"),
  views: [...document.querySelectorAll<HTMLButtonElement>(".views button")],
  type: $<HTMLSelectElement>("type"),
  clear: $<HTMLButtonElement>("clear"),
  notice: $("notice"),
  reload: $<HTMLButtonElement>("reload"),
  rows: $<HTMLTableSectionElement>("rows"),
  empty: $("empty"),
  detail: $("detail"),
  dName: $("d-name"),
  close: $<HTMLButtonElement>("close"),
  copy: $<HTMLButtonElement>("copy"),
  copyUrl: $<HTMLButtonElement>("copy-url"),
  openNetwork: $<HTMLButtonElement>("open-network"),
  toast: $("toast"),
  dOutcome: $("d-outcome"),
  dMeaning: $("d-meaning"),
  dRequest: $("d-request"),
  dBar: $("d-bar"),
  dTiming: $("d-timing"),
  dResponse: $("d-response"),
  dReport: $("d-report"),
};

const store = new RequestStore();
let filter: FilterState = { ...DEFAULT_FILTER };
let visible: NormalizedRequest[] = [];
let selectedId: number | null = null;
const rowCache = new Map<number, HTMLTableRowElement>();
let knownTypes: string[] = [];
let lastRenderedId = 0;

// ---------- Rendering ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildRow(req: NormalizedRequest): HTMLTableRowElement {
  const tr = el("tr", `o-${req.outcome}`);
  tr.dataset.id = String(req.id);
  tr.tabIndex = -1;
  tr.setAttribute("role", "row");
  tr.setAttribute("aria-selected", "false");

  const status = el("td", "c-status");
  status.append(el("span", "badge", statusCell(req)));
  status.title = statusLine(req);

  const name = el("td", "c-name");
  name.append(document.createTextNode(req.name));
  if (req.host && req.host !== req.name) name.append(el("span", "host", req.host));
  if (req.slow) name.append(el("span", "slow-tag", "slow"));
  name.title = req.url ?? "";

  const type = el("td", "c-type", req.resourceType);
  if (req.resourceTypeSource !== "devtools") type.classList.add("inferred");
  if (req.resourceTypeSource === "mime") type.title = "Inferred from MIME type";

  tr.append(status, el("td", "c-method", req.method ?? "n/a"), name, type, el("td", "c-time", formatMs(req.durationMs)));
  for (const cell of tr.children) cell.setAttribute("role", "gridcell");
  return tr;
}

function rowFor(req: NormalizedRequest): HTMLTableRowElement {
  let row = rowCache.get(req.id);
  if (!row) {
    row = buildRow(req);
    rowCache.set(req.id, row);
  }
  return row;
}

function updateEmptyState(): void {
  if (visible.length > 0) ui.empty.textContent = "";
  else if (store.all.length === 0)
    ui.empty.textContent =
      store.capture === "partial"
        ? "No requests captured yet. Interact with the page, or reload it to capture from the start."
        : "No requests captured since the last navigation.";
  else ui.empty.textContent = "No requests match the current filters.";
}

function renderList(): void {
  visible = applyFilter(store.all, filter);
  lastRenderedId = store.lastId;
  ui.rows.replaceChildren(...visible.map(rowFor));
  // A selected request hidden by a filter keeps its details open, so the user does not lose their place.
  syncSelection();
  updateEmptyState();
}

function appendRows(added: NormalizedRequest[]): void {
  // A full render may already have included part of this batch.
  const fresh = added.filter((r) => r.id > lastRenderedId && matches(r, filter));
  lastRenderedId = Math.max(lastRenderedId, added[added.length - 1]?.id ?? 0);
  if (fresh.length === 0) return updateEmptyState();
  visible.push(...fresh);
  ui.rows.append(...fresh.map(rowFor));
  updateEmptyState();
}

function renderSummary(): void {
  const s = summarize(store.all);
  for (const span of document.querySelectorAll<HTMLElement>("[data-count]")) {
    const value = s[span.dataset.count as keyof typeof s];
    span.textContent = String(value);
    span.classList.toggle("nonzero", value > 0);
  }
  const types = resourceTypes(store.all);
  if (types.join() !== knownTypes.join()) {
    knownTypes = types;
    const current = filter.type;
    ui.type.replaceChildren(new Option("All types", "all"), ...types.map((t) => new Option(t, t)));
    // Keep a selected type even if it is not in the current capture, so the filter never changes silently.
    if (current !== "all" && !types.includes(current)) ui.type.append(new Option(`${current} (none)`, current));
    ui.type.value = current;
  }
}

function renderNotice(): void {
  ui.notice.hidden = store.capture === "complete";
}

// ---------- Selection & details ----------

function syncSelection(): void {
  for (const row of ui.rows.children as HTMLCollectionOf<HTMLTableRowElement>) {
    const selected = row.dataset.id === String(selectedId);
    row.setAttribute("aria-selected", String(selected));
    row.tabIndex = selected ? 0 : -1;
  }
  // When nothing is selected, the first row is the keyboard entry point.
  if (selectedId === null || !visible.some((r) => r.id === selectedId)) {
    const first = ui.rows.firstElementChild as HTMLTableRowElement | null;
    if (first) first.tabIndex = 0;
  }
}

function select(id: number | null, focus = false): void {
  selectedId = id;
  syncSelection();
  const req = id === null ? undefined : store.get(id);
  if (!req) {
    ui.detail.hidden = true;
    return;
  }
  renderDetail(req);
  ui.detail.hidden = false;
  const row = rowCache.get(req.id);
  if (row) {
    row.scrollIntoView({ block: "nearest" });
    if (focus) row.focus();
  }
}

function addPair(dl: HTMLElement, label: string, value: string | null, title?: string): void {
  const dd = el("dd", value === null ? "na" : undefined, value ?? "n/a");
  if (title) dd.title = title;
  dl.append(el("dt", undefined, label), dd);
}

function renderDetail(req: NormalizedRequest): void {
  ui.dName.textContent = req.name;
  ui.dOutcome.textContent = statusLine(req);
  ui.dOutcome.className = `outcome o-${req.outcome}`;
  ui.dMeaning.textContent = describeOutcome(req);
  ui.toast.textContent = "";

  ui.dRequest.replaceChildren();
  addPair(ui.dRequest, "URL", req.url);
  addPair(ui.dRequest, "Method", req.method);
  addPair(ui.dRequest, "Type", req.resourceType === "unknown" ? null : req.resourceType + (req.resourceTypeSource === "mime" ? " (inferred from MIME type)" : ""));
  addPair(ui.dRequest, "Started", req.startedAt ? new Date(req.startedAt).toLocaleTimeString() : null, req.startedAt ?? undefined);
  if (req.redirectTo) addPair(ui.dRequest, "Redirects to", req.redirectTo);
  if (req.errorText) addPair(ui.dRequest, "Error", req.errorText);

  renderTiming(req);

  ui.dResponse.replaceChildren();
  addPair(ui.dResponse, "Status", req.status !== null ? `${req.status} ${req.statusText ?? ""}`.trim() : null);
  addPair(ui.dResponse, "Outcome", OUTCOME_LABEL[req.outcome]);
  addPair(ui.dResponse, "MIME type", req.mimeType);
  addPair(ui.dResponse, "Transferred", req.transferSize === null ? null : formatBytes(req.transferSize));
  if (req.fromCache) addPair(ui.dResponse, "Cache", `served from ${req.fromCache} cache`);
  addPair(ui.dResponse, "Protocol", req.httpVersion);
  addPair(ui.dResponse, "Server IP", req.serverIp);

  ui.dReport.textContent = buildReport(req, { capture: store.capture });
}

function renderTiming(req: NormalizedRequest): void {
  ui.dBar.replaceChildren();
  ui.dTiming.replaceChildren();
  addPair(ui.dTiming, "Total", req.durationMs === null ? null : formatMs(req.durationMs) + (req.slow ? " (slow)" : ""));

  const known = TIMING_PHASES.filter((p) => req.timings[p] !== null);
  const sum = known.reduce((acc, p) => acc + (req.timings[p] ?? 0), 0);
  for (const phase of TIMING_PHASES) {
    const ms = req.timings[phase];
    addPair(ui.dTiming, phase, ms === null ? null : formatMs(ms));
    const dt = ui.dTiming.lastElementChild?.previousElementSibling as HTMLElement | null;
    if (dt && ms !== null) dt.style.setProperty("--swatch", `var(--bar-${phase})`);
    if (ms !== null && sum > 0 && ms > 0) {
      const seg = el("span");
      seg.style.width = `${(ms / sum) * 100}%`;
      seg.style.background = `var(--bar-${phase})`;
      seg.title = `${phase}: ${formatMs(ms)}`;
      ui.dBar.append(seg);
    }
  }
  ui.dBar.hidden = sum === 0;
}

// ---------- Actions ----------

let toastTimer: number | undefined;
function toast(message: string, isError = false): void {
  ui.toast.textContent = message;
  ui.toast.classList.toggle("error", isError);
  window.clearTimeout(toastTimer);
  if (!isError) toastTimer = window.setTimeout(() => (ui.toast.textContent = ""), 2500);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // DevTools panels often deny the async clipboard API; fall back to a temporary textarea.
    const area = el("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

async function copyReport(): Promise<void> {
  const req = selectedId === null ? undefined : store.get(selectedId);
  if (!req) return;
  const text = buildReport(req, { capture: store.capture, generatedAt: new Date() });
  if (await copyText(text)) toast("Report copied. Sensitive URL values are redacted.");
  else {
    const details = ui.dReport.closest("details");
    if (details) details.open = true;
    window.getSelection()?.selectAllChildren(ui.dReport);
    toast("Copy was blocked. The report is selected below; press Ctrl+C (Cmd+C).", true);
  }
}

async function copyUrl(): Promise<void> {
  const req = selectedId === null ? undefined : store.get(selectedId);
  if (!req?.url) return;
  if (await copyText(req.url)) toast("Full URL copied (not redacted).");
  else toast("Copy was blocked by the browser.", true);
}

interface NetworkPanelLike {
  show?: (options?: { filter?: string }) => void;
}

function networkPanel(): NetworkPanelLike | undefined {
  const panels = globalThis.chrome?.devtools?.panels as unknown as { network?: NetworkPanelLike } | undefined;
  return typeof panels?.network?.show === "function" ? panels.network : undefined;
}

function openInNetwork(): void {
  const panel = networkPanel();
  const req = selectedId === null ? undefined : store.get(selectedId);
  if (!panel?.show || !req) return;
  try {
    panel.show({ filter: req.url ?? "" });
  } catch {
    panel.show();
  }
}

function setView(view: StatusView): void {
  filter = { ...filter, status: view };
  for (const b of ui.views) b.setAttribute("aria-checked", String(b.dataset.view === view));
  renderList();
}

// ---------- Events ----------

let searchTimer: number | undefined;
ui.search.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    filter = { ...filter, text: ui.search.value };
    renderList();
  }, 80);
});

for (const button of ui.views) button.addEventListener("click", () => setView(button.dataset.view as StatusView));

ui.views[0]?.parentElement?.addEventListener("keydown", (e) => {
  // Arrow keys move between view buttons, per the radiogroup pattern.
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const i = ui.views.findIndex((b) => b === document.activeElement);
  if (i < 0) return;
  const next = ui.views[(i + (e.key === "ArrowRight" ? 1 : ui.views.length - 1)) % ui.views.length]!;
  next.focus();
  next.click();
  e.preventDefault();
});

ui.type.addEventListener("change", () => {
  filter = { ...filter, type: ui.type.value };
  renderList();
});

ui.clear.addEventListener("click", () => {
  store.clear();
  select(null);
});

ui.reload.addEventListener("click", () => globalThis.chrome?.devtools?.inspectedWindow?.reload({}));

ui.rows.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest("tr");
  if (row?.dataset.id) select(Number(row.dataset.id), true);
});

ui.rows.addEventListener("keydown", (e) => {
  if (visible.length === 0) return;
  const index = visible.findIndex((r) => r.id === selectedId);
  let next: number | null = null;
  switch (e.key) {
    case "ArrowDown":
    case "j":
      next = Math.min(index + 1, visible.length - 1);
      break;
    case "ArrowUp":
    case "k":
      next = index < 0 ? 0 : Math.max(index - 1, 0);
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = visible.length - 1;
      break;
    case "Enter":
    case " ":
      if (index < 0) next = 0;
      break;
    default:
      return;
  }
  e.preventDefault();
  if (next !== null) select(visible[next]!.id, true);
});

ui.close.addEventListener("click", () => {
  const id = selectedId;
  select(null);
  if (id !== null) rowCache.get(id)?.focus();
});
ui.copy.addEventListener("click", () => void copyReport());
ui.copyUrl.addEventListener("click", () => void copyUrl());
ui.openNetwork.addEventListener("click", openInNetwork);
ui.openNetwork.hidden = networkPanel() === undefined;

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
  if (e.key === "/" && !typing) {
    ui.search.focus();
    ui.search.select();
    e.preventDefault();
  } else if (e.key === "Escape") {
    if (typing && ui.search.value) {
      ui.search.value = "";
      ui.search.dispatchEvent(new Event("input"));
    } else if (selectedId !== null) {
      ui.close.click();
    }
  } else if (e.key === "c" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && selectedId !== null) {
    void copyReport();
  }
});

// ---------- Store wiring ----------

let pendingAdds: NormalizedRequest[] = [];
let pendingInOrder = true;
let frame = 0;
store.subscribe((change) => {
  if (change.kind === "added") {
    // Batch bursts of requests into one paint.
    pendingAdds.push(...change.requests);
    pendingInOrder &&= change.appended;
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        const batch = pendingAdds;
        const inOrder = pendingInOrder;
        pendingAdds = [];
        pendingInOrder = true;
        // Appending is cheap; a request that belongs earlier in the list needs a full (cached-row) render.
        if (inOrder) appendRows(batch);
        else renderList();
        renderSummary();
      });
  } else if (change.kind === "reset") {
    pendingAdds = [];
    pendingInOrder = true;
    rowCache.clear();
    if (selectedId !== null) select(null);
    renderList();
    renderSummary();
  } else {
    renderNotice();
    updateEmptyState();
  }
});

function applyTheme(theme: string | undefined): void {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

const devtools = globalThis.chrome?.devtools;
applyTheme(devtools?.panels?.themeName);
devtools?.panels?.setThemeChangeHandler?.((theme) => applyTheme(theme));

renderNotice();
renderList();
renderSummary();
if (devtools?.network) startCapture(store, devtools.network as unknown as NetworkApi, { isActive: () => !document.hidden });
else ui.empty.textContent = "Quick Debug must run inside Chrome DevTools to capture requests.";
