// Pure filtering logic for the request list.
import type { NormalizedRequest } from "./model.js";

/** One-click status views. "problems" is the sensible default shortcut: failures, HTTP errors and slow requests. */
export type StatusView = "all" | "problems" | "failed" | "http-error" | "redirect" | "slow";

export interface FilterState {
  status: StatusView;
  /** Resource type, or "all". */
  type: string;
  /** Free text; space-separated terms must all match. */
  text: string;
}

export const DEFAULT_FILTER: FilterState = { status: "all", type: "all", text: "" };

export function isProblem(req: NormalizedRequest): boolean {
  return req.outcome === "failed" || req.outcome === "http-error" || req.slow;
}

export function matchesStatus(req: NormalizedRequest, view: StatusView): boolean {
  switch (view) {
    case "all":
      return true;
    case "problems":
      return isProblem(req);
    case "slow":
      return req.slow;
    default:
      return req.outcome === view;
  }
}

function haystack(req: NormalizedRequest): string {
  // The masked URL: searching never matches values the user cannot see.
  return [req.method, req.maskedUrl, req.status, req.statusText, req.resourceType, req.errorText, req.mimeType]
    .filter((v) => v !== null && v !== undefined)
    .join(" ")
    .toLowerCase();
}

export function matchesText(req: NormalizedRequest, text: string): boolean {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack(req);
  return terms.every((term) => hay.includes(term));
}

export function matches(req: NormalizedRequest, filter: FilterState): boolean {
  return (
    matchesStatus(req, filter.status) &&
    (filter.type === "all" || req.resourceType === filter.type) &&
    matchesText(req, filter.text)
  );
}

export function applyFilter(requests: readonly NormalizedRequest[], filter: FilterState): NormalizedRequest[] {
  return requests.filter((req) => matches(req, filter));
}

export interface Summary {
  total: number;
  problems: number;
  failed: number;
  httpErrors: number;
  redirects: number;
  slow: number;
}

export function summarize(requests: readonly NormalizedRequest[]): Summary {
  const s: Summary = { total: requests.length, problems: 0, failed: 0, httpErrors: 0, redirects: 0, slow: 0 };
  for (const req of requests) {
    if (isProblem(req)) s.problems++;
    if (req.outcome === "failed") s.failed++;
    if (req.outcome === "http-error") s.httpErrors++;
    if (req.outcome === "redirect") s.redirects++;
    if (req.slow) s.slow++;
  }
  return s;
}

/** Resource types present in the capture, sorted, for the type picker. */
export function resourceTypes(requests: readonly NormalizedRequest[]): string[] {
  return [...new Set(requests.map((r) => r.resourceType))].sort();
}
