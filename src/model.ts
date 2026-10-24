// Request data layer: turns the HAR entries exposed by chrome.devtools.network
// into a predictable internal model. Nothing here touches the DOM or chrome.*,
// so it can be tested in Node and reused by any UI.
//
// Rule: a value that DevTools did not give us stays `null`. We never fill a gap
// with a guessed number.

/** Shape of the HAR fields we read. Everything is optional because real captures are often partial. */
export interface HarEntryLike {
  startedDateTime?: string;
  time?: number;
  request?: { method?: string; url?: string; httpVersion?: string };
  response?: {
    status?: number;
    statusText?: string;
    redirectURL?: string;
    httpVersion?: string;
    content?: { mimeType?: string; size?: number };
    bodySize?: number;
    _transferSize?: number;
    _error?: string | null;
  };
  timings?: Partial<Record<TimingPhase, number>>;
  serverIPAddress?: string;
  _resourceType?: string;
  _fromCache?: string;
}

export const TIMING_PHASES = ["blocked", "dns", "connect", "ssl", "send", "wait", "receive"] as const;
export type TimingPhase = (typeof TIMING_PHASES)[number];

/**
 * How the request ended, as far as the captured data shows.
 * - success:    a 2xx response, or 304 Not Modified.
 * - redirect:   301/302/303/307/308.
 * - http-error: the server answered with 4xx/5xx. This is a fact about the
 *               response, not proof of an application defect (a 404 probe or a
 *               401 before login can be expected behaviour).
 * - failed:     no HTTP response at all (network error, blocked, cancelled).
 * - other:      1xx, other 3xx codes, or a status we cannot classify.
 */
export type Outcome = "success" | "redirect" | "http-error" | "failed" | "other";

export type ResourceTypeSource = "devtools" | "mime" | "unknown";

export interface NormalizedRequest {
  id: number;
  method: string | null;
  url: string | null;
  /** Last path segment (or host) used as the short display name. */
  name: string;
  host: string | null;
  /** HTTP status, or null when no response was received / reported. */
  status: number | null;
  statusText: string | null;
  outcome: Outcome;
  /** Network error text reported by Chrome, e.g. "net::ERR_CONNECTION_REFUSED". */
  errorText: string | null;
  redirectTo: string | null;
  resourceType: string;
  /** Where `resourceType` came from; "mime" means we inferred it and say so in the UI. */
  resourceTypeSource: ResourceTypeSource;
  mimeType: string | null;
  startedAt: string | null;
  /** `startedAt` as epoch ms, used for ordering; null when missing or unparseable. */
  startedMs: number | null;
  /** Total duration in ms, or null when unavailable. */
  durationMs: number | null;
  /** Per-phase timings in ms; null where HAR reports -1 or omits the phase. */
  timings: Record<TimingPhase, number | null>;
  transferSize: number | null;
  fromCache: string | null;
  serverIp: string | null;
  httpVersion: string | null;
  /** True when total duration is at or above SLOW_THRESHOLD_MS. False when unknown. */
  slow: boolean;
}

export const SLOW_THRESHOLD_MS = 1000;

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function num(value: unknown): number | null {
  // HAR uses -1 for "not available"; treat any negative or non-finite value the same way.
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function classifyOutcome(status: number | null): Outcome {
  // A response that started but was later aborted keeps its status; the error text is still shown in details.
  if (status === null || status === 0) return "failed";
  if (status === 304) return "success";
  if (status >= 200 && status < 300) return "success";
  if (REDIRECT_CODES.has(status)) return "redirect";
  if (status >= 400 && status < 600) return "http-error";
  return "other";
}

/** Plain-language meaning of an outcome, careful not to overstate what an HTTP error proves. */
export function describeOutcome(req: Pick<NormalizedRequest, "outcome" | "status" | "errorText">): string {
  switch (req.outcome) {
    case "success":
      return req.status === 304 ? "Not modified: the browser reused its cached copy." : "The server returned a successful response.";
    case "redirect":
      return "The server redirected this request to another URL.";
    case "http-error":
      return req.status !== null && req.status >= 500
        ? "The server responded with a 5xx status: it reported a problem handling the request."
        : "The server responded with a 4xx status: it rejected the request as sent. This can be expected behaviour (for example, a probe or a missing login); check whether the page relies on this response.";
    case "failed":
      return req.errorText
        ? `No HTTP response was received. Chrome reported: ${req.errorText}.`
        : "No HTTP response was received. The request may have failed, been blocked or been cancelled; DevTools did not report a reason.";
    case "other":
      return "The response status is outside the usual success, redirect and error ranges.";
  }
}

const MIME_TYPE_MAP: Array<[RegExp, string]> = [
  [/^text\/html|application\/xhtml\+xml/, "document"],
  [/^text\/css/, "stylesheet"],
  [/javascript|ecmascript/, "script"],
  [/^image\//, "image"],
  [/^font\/|application\/(x-)?font|woff/, "font"],
  [/^(audio|video)\//, "media"],
  [/json|xml/, "fetch"],
];

function inferTypeFromMime(mime: string | null): string | null {
  if (!mime) return null;
  const lower = mime.toLowerCase();
  for (const [pattern, type] of MIME_TYPE_MAP) if (pattern.test(lower)) return type;
  return null;
}

function displayName(url: string | null): { name: string; host: string | null } {
  if (!url) return { name: "(no URL)", host: null };
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "data:") return { name: url.slice(0, 40) + (url.length > 40 ? "…" : ""), host: null };
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return { name: last ? decodeSafe(last) : parsed.host || url, host: parsed.host || null };
  } catch {
    return { name: url, host: null };
  }
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Normalize one HAR entry. Never throws: malformed input yields a request with null fields. */
export function normalizeEntry(raw: unknown, id: number): NormalizedRequest {
  const entry = (raw && typeof raw === "object" ? raw : {}) as HarEntryLike;
  const request = entry.request ?? {};
  const response = entry.response ?? {};

  const url = str(request.url);
  const rawStatus = num(response.status);
  const errorText = str(response._error ?? null);
  // A status of 0 means "no response"; keep it out of the model as a number.
  const status = rawStatus === 0 ? null : rawStatus;
  const outcome = classifyOutcome(rawStatus);

  const mimeType = str(response.content?.mimeType);
  let resourceType = str(entry._resourceType);
  let resourceTypeSource: ResourceTypeSource = "devtools";
  if (!resourceType) {
    resourceType = inferTypeFromMime(mimeType);
    resourceTypeSource = resourceType ? "mime" : "unknown";
  }

  const timings = {} as Record<TimingPhase, number | null>;
  for (const phase of TIMING_PHASES) timings[phase] = num(entry.timings?.[phase]);

  const durationMs = num(entry.time);
  const { name, host } = displayName(url);

  return {
    id,
    method: str(request.method)?.toUpperCase() ?? null,
    url,
    name,
    host,
    status,
    statusText: str(response.statusText),
    outcome,
    errorText,
    redirectTo: str(response.redirectURL),
    resourceType: resourceType ?? "unknown",
    resourceTypeSource,
    mimeType,
    startedAt: str(entry.startedDateTime),
    startedMs: parseTime(entry.startedDateTime),
    durationMs,
    timings,
    transferSize: num(response._transferSize),
    fromCache: str(entry._fromCache),
    serverIp: str(entry.serverIPAddress),
    httpVersion: str(response.httpVersion) ?? str(request.httpVersion),
    slow: durationMs !== null && durationMs >= SLOW_THRESHOLD_MS,
  };
}

/**
 * True for a HAR entry that has neither a response nor an error yet. Chrome's
 * getHAR includes requests still in flight in this shape.
 */
export function isUnfinished(raw: unknown): boolean {
  const entry = (raw && typeof raw === "object" ? raw : {}) as HarEntryLike;
  return !num(entry.response?.status) && !str(entry.response?._error ?? null);
}

/** Identity used to drop duplicates when the same request arrives via getHAR and onRequestFinished. */
export function entryKey(raw: unknown): string {
  const entry = (raw && typeof raw === "object" ? raw : {}) as HarEntryLike;
  return [entry.startedDateTime ?? "", entry.request?.method ?? "", entry.request?.url ?? "", entry.time ?? ""].join("\u0000");
}
