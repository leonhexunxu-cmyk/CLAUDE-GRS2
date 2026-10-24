// Diagnostic report text. Contains only request metadata already visible in
// DevTools; never headers, cookies, or request/response bodies.
import { TIMING_PHASES, describeOutcome, type NormalizedRequest } from "./model.js";
import { redactUrl } from "./redact.js";
import { formatBytes, formatMs, statusLine, typeLabel } from "./format.js";

export type CaptureCompleteness = "complete" | "partial";

export interface ReportContext {
  capture: CaptureCompleteness;
  /** Browser/extension identification is left to the caller; keep it optional and local. */
  generatedAt?: Date;
}

function line(label: string, value: string): string {
  return `${(label + ":").padEnd(11)} ${value}`;
}

export function buildReport(req: NormalizedRequest, ctx: ReportContext): string {
  const url = redactUrl(req.url);
  const lines: string[] = ["Quick Debug request report", ""];

  lines.push(line("Request", `${req.method ?? "(method n/a)"} ${url.url}`));
  lines.push(line("Outcome", statusLine(req)));
  lines.push(line("Meaning", describeOutcome(req)));
  if (req.errorText) lines.push(line("Error", req.errorText));
  if (req.redirectTo) {
    const target = redactUrl(req.redirectTo);
    url.redactions += target.redactions;
    lines.push(line("Redirect", target.url));
  }
  lines.push(line("Type", typeLabel(req)));
  if (req.mimeType) lines.push(line("MIME", req.mimeType));
  lines.push(line("Started", req.startedAt ?? "n/a"));
  lines.push(line("Duration", formatMs(req.durationMs) + (req.slow ? " (slow)" : "")));

  const phases = TIMING_PHASES.map((p) => `${p} ${formatMs(req.timings[p])}`).join(", ");
  lines.push(line("Timing", phases));
  lines.push(line("Transfer", formatBytes(req.transferSize) + (req.fromCache ? ` (served from ${req.fromCache} cache)` : "")));
  if (req.httpVersion) lines.push(line("Protocol", req.httpVersion));

  lines.push("");
  lines.push(
    ctx.capture === "complete"
      ? "Capture: recorded since the last page navigation."
      : "Capture: partial. DevTools was opened after the page started loading, so earlier requests may be missing.",
  );
  lines.push("Values shown as n/a were not reported by DevTools.");
  lines.push(
    url.redactions > 0
      ? `Privacy: ${url.redactions} sensitive URL value(s) replaced with [REDACTED]. Headers, cookies and bodies are not included.`
      : "Privacy: no URL values needed redaction. Headers, cookies and bodies are not included.",
  );
  if (ctx.generatedAt) lines.push(`Generated: ${ctx.generatedAt.toISOString()}`);
  return lines.join("\n");
}
