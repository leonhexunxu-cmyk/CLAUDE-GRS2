// Quick Debug panel UI. Plain DOM, no framework.
import { RequestStore } from "./store.js";
import { startCapture, type NetworkApi } from "./capture.js";
import { DEFAULT_FILTER, applyFilter, matches, resourceTypes, summarize, type FilterState, type StatusView } from "./filter.js";
import { describeOutcome, displayName, type NormalizedRequest } from "./model.js";
import { OUTCOME_LABEL, formatBytes, formatMs, statusCell } from "./format.js";
import { buildReport, buildTechnicalReport, type TechnicalReport } from "./report.js";
import { redactUrl } from "./redact.js";
import { analyze, explainCode } from "./explain.js";
import { COMMANDS, parseCommand, pinnableText, type Command } from "./commands.js";
import { MAX_PINS, Prefs, type StorageLike, type ThemePref } from "./prefs.js";
import { isHalloweenSeason, msUntilSeasonEnds } from "./season.js";
import { ghostSvg, runSpooky } from "./spooky.js";
import { playLaunch } from "./launch.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  search: $<HTMLInputElement>("search"),
  views: [...document.querySelectorAll<HTMLButtonElement>(".views button")],
  menuViews: [...document.querySelectorAll<HTMLButtonElement>("#more .menu-item[data-view]")],
  more: $<HTMLDetailsElement>("more"),
  moreLabel: $("more-label"),
  actions: $<HTMLDetailsElement>("actions"),
  typeSelects: [$<HTMLSelectElement>("type"), $<HTMLSelectElement>("type-narrow")],
  clear: $<HTMLButtonElement>("clear"),
  notice: $("notice"),
  reload: $<HTMLButtonElement>("reload"),
  rows: $<HTMLTableSectionElement>("rows"),
  empty: $("empty"),
  detail: $("detail"),
  dName: $("d-name"),
  close: $<HTMLButtonElement>("close"),
  pill: $("d-pill"),
  statusTitle: $("d-status-title"),
  statusHelp: $<HTMLButtonElement>("status-help"),
  help: $("d-help"),
  helpMeaning: $("d-help-meaning"),
  helpCheck: $("d-help-check"),
  helpRef: $<HTMLAnchorElement>("d-help-ref"),
  dMeaning: $("d-meaning"),
  copy: $<HTMLButtonElement>("copy"),
  download: $<HTMLButtonElement>("download"),
  copyUrl: $<HTMLButtonElement>("copy-url"),
  openNetwork: $<HTMLButtonElement>("open-network"),
  toast: $("toast"),
  dAnalysis: $("d-analysis"),
  dBar: $("d-bar"),
  dTiming: $("d-timing"),
  dTimingNote: $("d-timing-note"),
  dRequest: $("d-request"),
  dResponse: $("d-response"),
  dReport: $("d-report"),
  consoleLog: $("console-log"),
  consoleForm: $<HTMLFormElement>("console-form"),
  consoleInput: $<HTMLInputElement>("console-input"),
  shortcuts: $("shortcuts"),
};

function safeStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const prefs = new Prefs(safeStorage());
const store = new RequestStore();
let filter: FilterState = { ...DEFAULT_FILTER };
let visible: NormalizedRequest[] = [];
let selectedId: number | null = null;
/** Per-request reveal of the unredacted URL; resets whenever the selection changes. */
let revealed = false;
const rowCache = new Map<number, HTMLTableRowElement>();
let knownTypes: string[] = [];
let lastRenderedId = 0;

// ---------- Masking (display only; the captured request is never changed) ----------

interface Masked {
  url: string;
  redirect: string | null;
  redactions: number;
  name: string;
  host: string | null;
}
const maskCache = new Map<number, Masked>();

function masked(req: NormalizedRequest): Masked {
  let m = maskCache.get(req.id);
  if (!m) {
    const u = redactUrl(req.url);
    const r = req.redirectTo ? redactUrl(req.redirectTo) : null;
    const shown = req.url ? displayName(u.url) : { name: req.name, host: null };
    m = { url: u.url, redirect: r?.url ?? null, redactions: u.redactions + (r?.redactions ?? 0), name: shown.name, host: shown.host ?? req.host };
    maskCache.set(req.id, m);
  }
  return m;
}

// ---------- Rendering ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildRow(req: NormalizedRequest): HTMLTableRowElement {
  const m = masked(req);
  const tr = el("tr", `o-${req.outcome}`);
  tr.dataset.id = String(req.id);
  tr.tabIndex = -1;
  tr.setAttribute("role", "row");
  tr.setAttribute("aria-selected", "false");

  const status = el("td", "c-status");
  status.append(el("span", "badge", statusCell(req)));
  status.title = `${OUTCOME_LABEL[req.outcome]}${req.statusText ? ": " + req.statusText : ""}`;

  const name = el("td", "c-name");
  name.append(document.createTextNode(m.name));
  if (m.host && m.host !== m.name) name.append(el("span", "host", m.host));
  if (req.slow) name.append(el("span", "slow-tag", "slow"));
  name.title = m.url;

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
  let text = "";
  if (visible.length === 0) {
    if (store.all.length === 0)
      text = store.capture === "partial" ? "No requests captured yet. Use the page, or reload it to capture from the start." : "No requests captured since the last navigation.";
    else text = "No requests match the current filters.";
  }
  ui.empty.replaceChildren();
  if (!text) return;
  if (document.documentElement.dataset.season === "halloween") ui.empty.append(ghostSvg("ghost-mark spooky-static"));
  ui.empty.append(document.createTextNode(text));
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
    if (span.dataset.count === "problems") span.classList.add("problem");
  }
  const types = resourceTypes(store.all);
  if (types.join() !== knownTypes.join()) {
    knownTypes = types;
    for (const select of ui.typeSelects) {
      select.replaceChildren(new Option("All types", "all"), ...types.map((t) => new Option(t, t)));
      // Keep a selected type even if it is not in the current capture, so the filter never changes silently.
      if (filter.type !== "all" && !types.includes(filter.type)) select.append(new Option(`${filter.type} (none)`, filter.type));
      select.value = filter.type;
    }
  }
}

function renderNotice(): void {
  ui.notice.hidden = store.capture === "complete";
}

const VIEW_LABEL: Record<StatusView, string> = { all: "All", problems: "Problems", failed: "No response", "http-error": "HTTP errors", redirect: "Redirects", slow: "Slow" };

function renderFilterState(): void {
  for (const b of ui.views) b.setAttribute("aria-checked", String(b.dataset.view === filter.status));
  for (const b of ui.menuViews) b.setAttribute("aria-checked", String(b.dataset.view === filter.status));
  for (const s of ui.typeSelects) s.value = filter.type;
  if (ui.search.value !== filter.text) ui.search.value = filter.text;
  // On narrow panels the menu label shows any filter it hides, so state is never invisible.
  const hidden = [filter.status !== "all" && filter.status !== "problems" ? VIEW_LABEL[filter.status] : "", filter.type !== "all" ? filter.type : ""].filter(Boolean);
  ui.moreLabel.textContent = hidden.length ? `Filters · ${hidden.join(", ")}` : "Filters";
}

function setFilter(next: Partial<FilterState>): void {
  filter = { ...filter, ...next };
  renderFilterState();
  renderList();
}

// ---------- Selection & details ----------

function syncSelection(): void {
  for (const row of ui.rows.children as HTMLCollectionOf<HTMLTableRowElement>) {
    const selected = row.dataset.id === String(selectedId);
    row.setAttribute("aria-selected", String(selected));
    row.tabIndex = selected ? 0 : -1;
  }
  if (selectedId === null || !visible.some((r) => r.id === selectedId)) {
    const first = ui.rows.firstElementChild as HTMLTableRowElement | null;
    if (first) first.tabIndex = 0;
  }
}

function selectedRequest(): NormalizedRequest | undefined {
  return selectedId === null ? undefined : store.get(selectedId);
}

function select(id: number | null, focus = false): void {
  if (id !== selectedId) revealed = false;
  selectedId = id;
  syncSelection();
  const req = selectedRequest();
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

function addPair(dl: HTMLElement, label: string, value: string | null): HTMLElement {
  const dd = el("dd", value === null ? "na" : undefined, value ?? "n/a");
  dl.append(el("dt", undefined, label), dd);
  return dd;
}

function codeFor(req: NormalizedRequest): string | null {
  if (req.outcome === "failed" && req.errorText) return req.errorText;
  return req.status !== null ? String(req.status) : null;
}

function renderDetail(req: NormalizedRequest): void {
  const m = masked(req);
  ui.dName.textContent = m.name;
  ui.pill.textContent = req.status !== null ? String(req.status) : req.outcome === "failed" ? "failed" : "n/a";
  ui.pill.className = `pill o-${req.outcome}`;
  ui.statusTitle.textContent = req.statusText || explainCode(String(req.status ?? ""))?.title || OUTCOME_LABEL[req.outcome];
  ui.dMeaning.textContent = describeOutcome(req);
  ui.toast.textContent = "";

  // Status help (the "?" button): hidden unless we have a real explanation.
  const code = codeFor(req);
  const help = code ? explainCode(code) : null;
  ui.statusHelp.hidden = help === null;
  ui.statusHelp.setAttribute("aria-expanded", "false");
  ui.help.hidden = true;
  if (help) {
    ui.statusHelp.setAttribute("aria-label", `Explain ${help.code}`);
    ui.helpMeaning.textContent = `${help.code} ${help.title}. ${help.meaning}`;
    ui.helpCheck.textContent = help.check;
    ui.helpRef.hidden = !help.reference;
    if (help.reference) ui.helpRef.href = help.reference;
  }

  renderAnalysis(req);
  renderTiming(req);
  renderRequestFacts(req, m);

  ui.dResponse.replaceChildren();
  addPair(ui.dResponse, "Status", req.status !== null ? `${req.status} ${req.statusText ?? ""}`.trim() : null);
  addPair(ui.dResponse, "MIME type", req.mimeType);
  addPair(ui.dResponse, "Transferred", req.transferSize === null ? null : formatBytes(req.transferSize));
  if (req.fromCache) addPair(ui.dResponse, "Cache", `served from ${req.fromCache} cache`);
  addPair(ui.dResponse, "Protocol", req.httpVersion);
  addPair(ui.dResponse, "Server IP", req.serverIp);
  ui.dReport.textContent = buildReport(req, { capture: store.capture });
}

function renderRequestFacts(req: NormalizedRequest, m: Masked): void {
  ui.dRequest.replaceChildren();
  const showOriginal = revealed && m.redactions > 0;
  const urlDd = addPair(ui.dRequest, "URL", showOriginal ? req.url : m.url);
  urlDd.id = "d-url";
  if (m.redactions > 0) {
    urlDd.append(el("span", "masked-flag", showOriginal ? "unredacted" : `${m.redactions} hidden`));
    const toggle = el("button", "inline-btn", showOriginal ? "Hide" : "Reveal");
    toggle.type = "button";
    toggle.id = "reveal-url";
    toggle.title = showOriginal ? "Mask sensitive values again" : "Show the original, unredacted URL";
    toggle.addEventListener("click", () => {
      revealed = !revealed;
      renderRequestFacts(req, m);
    });
    urlDd.append(toggle);
  }
  addPair(ui.dRequest, "Method", req.method);
  addPair(ui.dRequest, "Type", req.resourceType === "unknown" ? null : req.resourceType + (req.resourceTypeSource === "mime" ? " (inferred from MIME type)" : ""));
  addPair(ui.dRequest, "Started", req.startedAt ? new Date(req.startedAt).toLocaleTimeString() : null);
  if (req.redirectTo) addPair(ui.dRequest, "Redirects to", showOriginal ? req.redirectTo : m.redirect);
  if (req.errorText) addPair(ui.dRequest, "Error", req.errorText);
  ui.copyUrl.textContent = showOriginal ? "Copy original URL" : "Copy URL";
  ui.copyUrl.hidden = req.url === null;
}

function renderAnalysis(req: NormalizedRequest): void {
  const findings = analyze(req);
  ui.dAnalysis.replaceChildren();
  if (findings.length === 0) ui.dAnalysis.append(el("li", undefined, "Nothing unusual in the captured data."));
  for (const f of findings) {
    const li = el("li", f.kind);
    li.append(el("strong", undefined, f.title), el("span", "detail-text", f.detail));
    const initiator = req.initiator;
    const open = openResourceApi();
    if (f.kind === "initiator" && initiator?.url && open) {
      const button = el("button", "inline-btn", "Open in Sources");
      button.type = "button";
      button.id = "open-source";
      button.addEventListener("click", () => open(initiator.url!, initiator.lineNumber ?? 0, () => {}));
      li.append(button);
    }
    ui.dAnalysis.append(li);
  }
}

/** Bar segments: connect is split into TCP and TLS because HAR's `connect` already includes `ssl`. */
function barSegments(req: NormalizedRequest): Array<{ key: string; ms: number }> {
  const t = req.timings;
  const segs: Array<{ key: string; ms: number | null }> = [
    { key: "blocked", ms: t.blocked },
    { key: "dns", ms: t.dns },
    { key: "connect", ms: t.connect === null ? null : t.connect - (t.ssl ?? 0) },
    { key: "ssl", ms: t.ssl },
    { key: "send", ms: t.send },
    { key: "wait", ms: t.wait },
    { key: "receive", ms: t.receive },
  ];
  return segs.filter((s): s is { key: string; ms: number } => s.ms !== null && s.ms > 0);
}

function renderTiming(req: NormalizedRequest): void {
  ui.dBar.replaceChildren();
  ui.dTiming.replaceChildren();
  addPair(ui.dTiming, "Total", req.durationMs === null ? null : formatMs(req.durationMs) + (req.slow ? " (slow)" : ""));

  const segs = barSegments(req);
  const sum = segs.reduce((a, s) => a + s.ms, 0);
  for (const s of segs) {
    const seg = el("span");
    seg.style.width = `${(s.ms / sum) * 100}%`;
    seg.style.background = `var(--bar-${s.key})`;
    seg.title = `${s.key}: ${formatMs(s.ms)}`;
    ui.dBar.append(seg);
  }
  ui.dBar.hidden = sum === 0;

  const t = req.timings;
  const phases: Array<[string, string, number | null]> = [
    ["blocked", "blocked", t.blocked],
    ["dns", "dns", t.dns],
    ["connect", t.ssl !== null ? "connect (incl. ssl)" : "connect", t.connect],
    ["ssl", "ssl", t.ssl],
    ["send", "send", t.send],
    ["wait", "wait (TTFB)", t.wait],
    ["receive", "receive", t.receive],
  ];
  const missing: string[] = [];
  for (const [key, label, ms] of phases) {
    if (ms === null) {
      missing.push(key);
      continue;
    }
    addPair(ui.dTiming, label, formatMs(ms));
    (ui.dTiming.lastElementChild?.previousElementSibling as HTMLElement).style.setProperty("--swatch", `var(--bar-${key})`);
  }
  const notes: string[] = [];
  if (missing.length) notes.push(`Not reported by DevTools: ${missing.join(", ")}.`);
  if (req.timingCheck.consistent === false && req.timingCheck.phaseSum !== null)
    notes.push(`The phases add up to ${formatMs(req.timingCheck.phaseSum)}, not the reported total; both are shown as reported.`);
  ui.dTimingNote.textContent = notes.join(" ");
}

// ---------- Actions ----------

let toastTimer: number | undefined;
function toast(message: string, isError = false): void {
  ui.toast.textContent = message;
  ui.toast.classList.toggle("error", isError);
  window.clearTimeout(toastTimer);
  if (!isError) toastTimer = window.setTimeout(() => (ui.toast.textContent = ""), 3000);
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

async function copyReport(): Promise<boolean> {
  const req = selectedRequest();
  if (!req) return false;
  const text = buildReport(req, { capture: store.capture, generatedAt: new Date() });
  if (await copyText(text)) {
    toast("Report copied. Sensitive URL values are redacted.");
    return true;
  }
  const details = ui.dReport.closest("details");
  if (details) details.open = true;
  window.getSelection()?.selectAllChildren(ui.dReport);
  toast("Copy was blocked. The report is selected below; press Ctrl+C (Cmd+C).", true);
  return false;
}

async function copyUrl(): Promise<void> {
  const req = selectedRequest();
  if (!req?.url) return;
  const m = masked(req);
  const original = revealed && m.redactions > 0;
  if (await copyText(original ? req.url : m.url))
    toast(original ? "Original URL copied. It contains unredacted values." : m.redactions ? "URL copied with sensitive values redacted." : "URL copied.");
  else toast("Copy was blocked by the browser.", true);
}

function triggerDownload(report: TechnicalReport): boolean {
  try {
    const blob = new Blob([report.content], { type: `${report.mime};charset=utf-8` });
    const href = URL.createObjectURL(blob);
    const a = el("a");
    a.href = href;
    a.download = report.filename;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return true;
  } catch {
    return false;
  }
}

/** Returns a message describing what actually happened. */
function downloadReport(format: "md" | "json", scope: "selected" | "visible"): { ok: boolean; message: string } {
  const requests = scope === "selected" ? [selectedRequest()].filter((r): r is NormalizedRequest => Boolean(r)) : visible;
  if (requests.length === 0) return { ok: false, message: scope === "selected" ? "Select a request first." : "No visible requests to report." };
  const report = buildTechnicalReport(
    requests,
    { capture: store.capture, generatedAt: new Date(), scope: scope === "selected" ? "selected request" : `visible requests (${requests.length})` },
    format,
  );
  return triggerDownload(report)
    ? { ok: true, message: `Download started: ${report.filename} (${requests.length} request${requests.length === 1 ? "" : "s"}, redacted).` }
    : { ok: false, message: "The browser blocked the download." };
}

interface NetworkPanelLike {
  show?: (options?: { filter?: string }) => void;
}

function networkPanel(): NetworkPanelLike | undefined {
  const panels = globalThis.chrome?.devtools?.panels as unknown as { network?: NetworkPanelLike } | undefined;
  return typeof panels?.network?.show === "function" ? panels.network : undefined;
}

type OpenResource = (url: string, line: number, callback: () => void) => void;
function openResourceApi(): OpenResource | undefined {
  const fn = globalThis.chrome?.devtools?.panels?.openResource as unknown;
  return typeof fn === "function" ? (fn as OpenResource) : undefined;
}

function openInNetwork(): void {
  const panel = networkPanel();
  const req = selectedRequest();
  if (!panel?.show || !req) return;
  try {
    // The Network panel filter gets the URL path only, so no query values travel into it.
    panel.show({ filter: req.url ? new URL(req.url).pathname : "" });
  } catch {
    panel.show();
  }
}

// ---------- Theme & season ----------

function applyTheme(): void {
  const pref = prefs.theme;
  const devtoolsTheme = globalThis.chrome?.devtools?.panels?.themeName;
  const systemDark = (() => {
    try {
      return matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  })();
  const dark = pref === "dark" || (pref === "auto" && (devtoolsTheme ? devtoolsTheme === "dark" : systemDark));
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")) b.setAttribute("aria-checked", String(b.dataset.themeChoice === pref));
}

function setTheme(theme: ThemePref): void {
  prefs.setTheme(theme);
  applyTheme();
}

function applySeason(): void {
  let on = false;
  try {
    on = isHalloweenSeason(new Date());
  } catch {
    on = false;
  }
  if (on) document.documentElement.dataset.season = "halloween";
  else delete document.documentElement.dataset.season;
  updateEmptyState();
  // One timer switches the decoration off at the end of Nov 1 if the panel stays open.
  const remaining = on ? msUntilSeasonEnds(new Date()) : null;
  if (remaining !== null && remaining < 2 ** 31 - 1) window.setTimeout(applySeason, remaining + 1000);
}

// ---------- Console ----------

const history: string[] = [];
let historyIndex = -1;
const MAX_LOG_LINES = 100;
/** Frequent-command suggestions are computed once per panel load, so they never move while in use. */
const NO_ARG_COMMANDS = ["/copy", "/reset", "/slowest", "/download", "/help", "/spooky", "/pins"];
const suggestionsAtLoad = prefs.topCommands(5).filter((c) => NO_ARG_COMMANDS.includes(c)).slice(0, 2);
let showSuggestions = true;

function log(text: string | Node[], kind: "ok" | "error" | "info" | "echo"): HTMLElement {
  ui.consoleLog.hidden = false;
  const line = el("div", `line ${kind}`);
  if (typeof text === "string") line.textContent = text;
  else line.append(...text);
  ui.consoleLog.append(line);
  while (ui.consoleLog.childElementCount > MAX_LOG_LINES) ui.consoleLog.firstElementChild?.remove();
  ui.consoleLog.scrollTop = ui.consoleLog.scrollHeight;
  return line;
}

function validPins(): string[] {
  return prefs.pins.filter((p) => {
    const r = parseCommand(p);
    return r.ok && pinnableText(r.command) === p;
  });
}

function renderShortcuts(): void {
  ui.shortcuts.replaceChildren();
  const pins = validPins();
  const items = pins.length ? pins : showSuggestions ? suggestionsAtLoad : [];
  if (!pins.length && items.length) ui.shortcuts.append(el("span", "label", "Frequent:"));
  for (const text of items) {
    const b = el("button", undefined, text);
    b.type = "button";
    b.title = pins.length ? `Pinned: ${text}` : `Frequently used: ${text}`;
    b.addEventListener("click", () => void execute(text));
    ui.shortcuts.append(b);
  }
}

function helpLines(topic: string | null): void {
  const list = topic ? COMMANDS.filter((c) => c.name === topic) : COMMANDS;
  for (const c of list) log(`${c.usage}  —  ${c.summary}`, "info");
  if (!topic) log("Keys: / search · ` console · ↑↓ history · Esc close. Only these commands exist; nothing else is executed.", "info");
}

function runCommand(cmd: Command): Promise<boolean> | boolean {
  switch (cmd.name) {
    case "/help":
      helpLines(cmd.topic);
      return true;
    case "/show":
      setFilter({ status: cmd.view });
      log(`Showing ${VIEW_LABEL[cmd.view]}: ${visible.length} request${visible.length === 1 ? "" : "s"}.`, "ok");
      return true;
    case "/type":
      if (cmd.type !== "all" && !knownTypes.includes(cmd.type)) {
        log(`No captured requests of type "${cmd.type}". Captured types: ${knownTypes.join(", ") || "none yet"}.`, "error");
        return false;
      }
      setFilter({ type: cmd.type });
      log(`Type filter: ${cmd.type === "all" ? "all types" : cmd.type} (${visible.length} shown).`, "ok");
      return true;
    case "/search":
      setFilter({ text: cmd.text });
      log(cmd.text ? `Search applied (${visible.length} match${visible.length === 1 ? "" : "es"}).` : "Search cleared.", "ok");
      return true;
    case "/slowest": {
      const timed = store.all
        .filter((r) => r.durationMs !== null)
        .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
        .slice(0, cmd.count);
      if (timed.length === 0) {
        log("No captured request has a reported duration yet.", "error");
        return false;
      }
      log(`Slowest ${timed.length} of ${store.all.length} captured:`, "ok");
      timed.forEach((r, i) => {
        const m = masked(r);
        log(`${String(i + 1).padStart(2)}. ${formatMs(r.durationMs).padStart(8)}  ${r.method ?? ""} ${m.name}${m.host && m.host !== m.name ? " (" + m.host + ")" : ""}`, "info");
      });
      return true;
    }
    case "/reset":
      setFilter({ ...DEFAULT_FILTER });
      log("Filters reset: all requests, all types, no search.", "ok");
      return true;
    case "/select": {
      const req = visible[cmd.index - 1];
      if (!req) {
        log(`There is no row ${cmd.index}; ${visible.length} request${visible.length === 1 ? " is" : "s are"} visible.`, "error");
        return false;
      }
      select(req.id);
      log(`Selected row ${cmd.index}: ${masked(req).name}.`, "ok");
      return true;
    }
    case "/copy":
      if (!selectedRequest()) {
        log("Select a request first (click a row or use /select <n>).", "error");
        return false;
      }
      return copyReport().then((ok) => {
        log(ok ? "Redacted report copied to the clipboard." : "The browser blocked the clipboard; the report is selected in the details pane instead.", ok ? "ok" : "error");
        return ok;
      });
    case "/download": {
      const r = downloadReport(cmd.format, cmd.scope);
      log(r.message, r.ok ? "ok" : "error");
      return r.ok;
    }
    case "/explain": {
      const h = explainCode(cmd.code);
      if (!h) {
        log(`No explanation available for ${cmd.code}.`, "error");
        return false;
      }
      log(`${h.code} ${h.title}`, "ok");
      log(h.meaning, "info");
      log(`Check: ${h.check}`, "info");
      if (h.reference) log(`Reference: ${h.reference}`, "info");
      return true;
    }
    case "/theme":
      setTheme(cmd.theme);
      log(`Theme: ${cmd.theme}.`, "ok");
      return true;
    case "/pin": {
      const parsed = parseCommand(cmd.target.startsWith("/") ? cmd.target : "/" + cmd.target);
      const text = parsed.ok ? pinnableText(parsed.command) : null;
      if (!text) {
        log(`Cannot pin "${cmd.target}". Only commands with fixed arguments can be pinned (not /search or /select).`, "error");
        return false;
      }
      const pins = validPins();
      if (pins.includes(text)) {
        log(`${text} is already pinned.`, "info");
        return true;
      }
      if (pins.length >= MAX_PINS) {
        log(`You can pin up to ${MAX_PINS} commands. Remove one with /unpin.`, "error");
        return false;
      }
      prefs.setPins([...pins, text]);
      renderShortcuts();
      const saved = prefs.pins.includes(text);
      log(saved ? `Pinned ${text}.` : "Could not save the pin (browser storage is unavailable).", saved ? "ok" : "error");
      return saved;
    }
    case "/unpin": {
      const parsed = parseCommand(cmd.target.startsWith("/") ? cmd.target : "/" + cmd.target);
      const text = (parsed.ok && pinnableText(parsed.command)) || cmd.target;
      const pins = validPins();
      if (!pins.includes(text)) {
        log(`${text} is not pinned. Pinned: ${pins.join(", ") || "none"}.`, "error");
        return false;
      }
      prefs.setPins(pins.filter((p) => p !== text));
      renderShortcuts();
      log(`Unpinned ${text}.`, "ok");
      return true;
    }
    case "/pins": {
      const pins = validPins();
      log(pins.length ? `Pinned: ${pins.join(", ")}` : "Nothing pinned. Try /pin /show problems.", "info");
      return true;
    }
    case "/reset-usage":
      prefs.resetUsage();
      showSuggestions = false;
      renderShortcuts();
      log("Local command-usage counts were deleted.", "ok");
      return true;
    case "/clear":
      store.clear();
      select(null);
      log("Request list cleared (the Network panel is unchanged).", "ok");
      return true;
    case "/cls":
      ui.consoleLog.replaceChildren();
      ui.consoleLog.hidden = true;
      return true;
    case "/spooky":
      return spooky();
  }
}

function spooky(): boolean {
  const lane = el("div", "spooky-lane");
  lane.setAttribute("aria-hidden", "true");
  ui.consoleLog.hidden = false;
  ui.consoleLog.append(lane);
  const result = runSpooky(lane, () => lane.remove());
  if (result !== "animated") lane.remove();
  switch (result) {
    case "animated":
      log("Boo! A small ghost drifts by.", "ok");
      return true;
    case "static":
      log([ghostSvg("spooky-static"), document.createTextNode("Boo! (Reduced motion is on, so the ghost stays still.)")], "ok");
      return true;
    case "busy":
      log("The ghost is already floating by.", "info");
      return true;
    case "expired":
      log("Halloween mode has expired (it ran until November 1, 2026).", "info");
      return false;
  }
}

async function execute(input: string): Promise<void> {
  log(`› ${input}`, "echo");
  const parsed = parseCommand(input);
  if (!parsed.ok) {
    log(parsed.error, "error");
    return;
  }
  const ok = await runCommand(parsed.command);
  if (ok && parsed.command.name !== "/cls") prefs.recordUse(parsed.command.name);
}

ui.consoleForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = ui.consoleInput.value.trim();
  if (!input) return;
  if (history[history.length - 1] !== input) history.push(input);
  if (history.length > 50) history.shift();
  historyIndex = -1;
  ui.consoleInput.value = "";
  void execute(input);
});

ui.consoleInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    if (history.length === 0) return;
    e.preventDefault();
    if (e.key === "ArrowUp") historyIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
    else historyIndex = historyIndex < 0 || historyIndex + 1 >= history.length ? -1 : historyIndex + 1;
    ui.consoleInput.value = historyIndex < 0 ? "" : history[historyIndex]!;
  } else if (e.key === "Escape") {
    ui.consoleInput.value = "";
    ui.consoleInput.blur();
    e.stopPropagation();
  }
});

// ---------- Events ----------

let searchTimer: number | undefined;
ui.search.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => setFilter({ text: ui.search.value }), 80);
});

for (const button of [...ui.views, ...ui.menuViews])
  button.addEventListener("click", () => {
    setFilter({ status: button.dataset.view as StatusView });
    ui.more.open = false;
  });

ui.views[0]?.parentElement?.addEventListener("keydown", (e) => {
  // Arrow keys move between the visible view buttons, per the radiogroup pattern.
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const shown = ui.views.filter((b) => b.offsetParent !== null);
  const i = shown.findIndex((b) => b === document.activeElement);
  if (i < 0) return;
  const next = shown[(i + (e.key === "ArrowRight" ? 1 : shown.length - 1)) % shown.length]!;
  next.focus();
  next.click();
  e.preventDefault();
});

for (const select of ui.typeSelects)
  select.addEventListener("change", () => {
    setFilter({ type: select.value });
    ui.more.open = false;
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
ui.statusHelp.addEventListener("click", () => {
  const open = ui.help.hidden;
  ui.help.hidden = !open;
  ui.statusHelp.setAttribute("aria-expanded", String(open));
});
ui.copy.addEventListener("click", () => void copyReport());
ui.download.addEventListener("click", () => {
  const r = downloadReport("md", "selected");
  toast(r.message, !r.ok);
});
ui.copyUrl.addEventListener("click", () => void copyUrl());
ui.openNetwork.addEventListener("click", openInNetwork);
ui.openNetwork.hidden = networkPanel() === undefined;

ui.actions.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-action],[data-theme-choice]");
  if (!target) return;
  if (target.dataset.themeChoice) {
    setTheme(target.dataset.themeChoice as ThemePref);
    return; // keep the menu open so the choice stays visible
  }
  ui.actions.open = false;
  switch (target.dataset.action) {
    case "download-md":
    case "download-json": {
      const r = downloadReport(target.dataset.action === "download-md" ? "md" : "json", "visible");
      log(r.message, r.ok ? "ok" : "error");
      break;
    }
    case "help":
      helpLines(null);
      ui.consoleInput.focus();
      break;
    case "reset-usage":
      void execute("/reset-usage");
      break;
  }
});

// Close open menus on outside clicks.
document.addEventListener("click", (e) => {
  for (const menu of [ui.more, ui.actions]) if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
});

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
  if (e.key === "/" && !typing) {
    ui.search.focus();
    ui.search.select();
    e.preventDefault();
  } else if (e.key === "`" && !typing) {
    ui.consoleInput.focus();
    e.preventDefault();
  } else if (e.key === "Escape") {
    if (ui.more.open || ui.actions.open) {
      ui.more.open = false;
      ui.actions.open = false;
    } else if (typing && ui.search.value) {
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
    maskCache.clear();
    if (selectedId !== null) select(null);
    renderList();
    renderSummary();
  } else {
    renderNotice();
    updateEmptyState();
  }
});

const devtools = globalThis.chrome?.devtools;
applyTheme();
devtools?.panels?.setThemeChangeHandler?.(() => applyTheme());
applySeason();
// Cosmetic splash; capture below starts at the same time and is not delayed by it.
playLaunch(document.body);
renderShortcuts();
renderFilterState();
renderNotice();
renderList();
renderSummary();
if (devtools?.network) startCapture(store, devtools.network as unknown as NetworkApi, { isActive: () => !document.hidden });
else ui.empty.textContent = "Quick Debug must run inside Chrome DevTools to capture requests.";
