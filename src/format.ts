// Small display helpers shared by the panel and the report.
import type { NormalizedRequest, Outcome } from "./model.js";

export function formatMs(ms: number | null): string {
  if (ms === null) return "n/a";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "n/a";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  success: "OK",
  redirect: "Redirect",
  "http-error": "HTTP error",
  failed: "No response",
  other: "Other",
};

/** Short status cell text: the code when there is one, otherwise what we know. */
export function statusCell(req: NormalizedRequest): string {
  if (req.status !== null) return String(req.status);
  return req.outcome === "failed" ? "(failed)" : "n/a";
}

export function statusLine(req: NormalizedRequest): string {
  const code = req.status !== null ? `${req.status}${req.statusText ? " " + req.statusText : ""}` : "no status";
  return `${OUTCOME_LABEL[req.outcome]} (${code})`;
}

export function typeLabel(req: NormalizedRequest): string {
  return req.resourceTypeSource === "mime" ? `${req.resourceType} (inferred from MIME type)` : req.resourceType;
}
