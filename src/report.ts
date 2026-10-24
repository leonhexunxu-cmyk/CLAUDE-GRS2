// Diagnostic reports: a compact text report for the clipboard and downloadable
// technical reports (Markdown or JSON). All of them contain only request
// metadata already visible in DevTools, never headers, cookies or bodies, and
// every URL goes through redaction.
import { TIMING_PHASES, describeOutcome, type NormalizedRequest } from "./model.js";
import { redactUrl } from "./redact.js";
import { OUTCOME_LABEL, formatBytes, formatMs, statusLine, typeLabel } from "./format.js";
import { analyze, explainCode, likelySource, SOURCE_LABEL } from "./explain.js";
import { summarize } from "./filter.js";

export type CaptureCompleteness = "complete" | "partial";

export interface ReportContext {
  capture: CaptureCompleteness;
  generatedAt?: Date;
}

const PRIVACY_NOTE = "Headers, cookies, request bodies and response bodies are not included.";

function line(label: string, value: string): string {
  return `${(label + ":").padEnd(11)} ${value}`;
}

function captureNote(capture: CaptureCompleteness): string {
  return capture === "complete"
    ? "Capture: recorded since the last page navigation."
    : "Capture: partial. DevTools was opened after the page started loading, so earlier requests may be missing.";
}

function timingLine(req: NormalizedRequest): string {
  return TIMING_PHASES.map((p) => `${p} ${formatMs(req.timings[p])}`).join(", ") + " (ssl is part of connect)";
}

/** Redacted URL plus the number of values hidden, for one request. */
function urls(req: NormalizedRequest): { url: string; redirect: string | null; redactions: number } {
  const u = redactUrl(req.url);
  const r = req.redirectTo ? redactUrl(req.redirectTo) : null;
  return { url: u.url, redirect: r?.url ?? null, redactions: u.redactions + (r?.redactions ?? 0) };
}

export function buildReport(req: NormalizedRequest, ctx: ReportContext): string {
  const u = urls(req);
  const lines: string[] = ["Quick Debug request report", ""];

  lines.push(line("Request", `${req.method ?? "(method n/a)"} ${u.url}`));
  lines.push(line("Outcome", statusLine(req)));
  lines.push(line("Meaning", describeOutcome(req)));
  if (req.errorText) lines.push(line("Error", req.errorText));
  if (u.redirect) lines.push(line("Redirect", u.redirect));
  lines.push(line("Type", typeLabel(req)));
  if (req.mimeType) lines.push(line("MIME", req.mimeType));
  lines.push(line("Started", req.startedAt ?? "n/a"));
  lines.push(line("Duration", formatMs(req.durationMs) + (req.slow ? " (slow)" : "")));
  lines.push(line("Timing", timingLine(req)));
  lines.push(line("Transfer", formatBytes(req.transferSize) + (req.fromCache ? ` (served from ${req.fromCache} cache)` : "")));
  if (req.httpVersion) lines.push(line("Protocol", req.httpVersion));

  const findings = analyze(req);
  if (findings.length) {
    lines.push("", "Analysis:");
    for (const f of findings) lines.push(`- ${f.title}: ${f.detail}`);
  }

  lines.push("", captureNote(ctx.capture), "Values shown as n/a were not reported by DevTools.");
  lines.push(
    u.redactions > 0
      ? `Privacy: ${u.redactions} sensitive URL value(s) replaced with [REDACTED]. ${PRIVACY_NOTE}`
      : `Privacy: no URL values needed redaction. ${PRIVACY_NOTE}`,
  );
  if (ctx.generatedAt) lines.push(`Generated: ${ctx.generatedAt.toISOString()}`);
  return lines.join("\n");
}

/** Plain JSON view of one request for the technical report. Redacted; no headers or bodies exist in the model. */
export function requestRecord(req: NormalizedRequest): Record<string, unknown> {
  const u = urls(req);
  const help = req.outcome === "failed" && req.errorText ? explainCode(req.errorText) : req.status !== null ? explainCode(String(req.status)) : null;
  const source = likelySource(req);
  return {
    method: req.method,
    url: u.url,
    status: req.status,
    statusText: req.statusText,
    outcome: req.outcome,
    outcomeLabel: OUTCOME_LABEL[req.outcome],
    meaning: describeOutcome(req),
    statusHelp: help ? { code: help.code, title: help.title, meaning: help.meaning, check: help.check } : null,
    likelySource: source ? SOURCE_LABEL[source] : null,
    error: req.errorText,
    redirectTo: u.redirect,
    resourceType: req.resourceType,
    resourceTypeSource: req.resourceTypeSource,
    mimeType: req.mimeType,
    startedAt: req.startedAt,
    durationMs: req.durationMs,
    slow: req.slow,
    timingsMs: { ...req.timings, queueing: req.queueingMs },
    timingCheck: req.timingCheck,
    initiator: req.initiator ? { ...req.initiator, url: req.initiator.url ? redactUrl(req.initiator.url).url : null } : null,
    transferSize: req.transferSize,
    fromCache: req.fromCache,
    httpVersion: req.httpVersion,
    analysis: analyze(req),
    redactedValues: u.redactions,
  };
}

export interface TechnicalReport {
  format: "md" | "json";
  filename: string;
  mime: string;
  content: string;
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** Downloadable report for one or more requests. */
export function buildTechnicalReport(requests: readonly NormalizedRequest[], ctx: ReportContext & { generatedAt: Date; scope: string }, format: "md" | "json"): TechnicalReport {
  const summary = summarize(requests);
  const filename = `quick-debug-report-${stamp(ctx.generatedAt)}.${format}`;
  if (format === "json") {
    const content = JSON.stringify(
      {
        tool: "Quick Debug",
        generatedAt: ctx.generatedAt.toISOString(),
        scope: ctx.scope,
        capture: ctx.capture,
        privacy: `URLs are redacted. ${PRIVACY_NOTE}`,
        notes: ["null means DevTools did not report the value.", "ssl time is included in connect (HAR 1.2)."],
        summary,
        requests: requests.map(requestRecord),
      },
      null,
      2,
    );
    return { format, filename, mime: "application/json", content };
  }

  const md: string[] = [
    "# Quick Debug technical report",
    "",
    `- Generated: ${ctx.generatedAt.toISOString()}`,
    `- Scope: ${ctx.scope}`,
    `- ${captureNote(ctx.capture)}`,
    `- Privacy: URLs are redacted. ${PRIVACY_NOTE}`,
    "",
    "## Summary",
    "",
    "| Requests | Problems | No response | HTTP errors | Redirects | Slow |",
    "|---|---|---|---|---|---|",
    `| ${summary.total} | ${summary.problems} | ${summary.failed} | ${summary.httpErrors} | ${summary.redirects} | ${summary.slow} |`,
  ];
  const escape = (s: string) => s.replace(/\|/g, "\\|");
  if (requests.length > 1) {
    md.push("", "## Requests", "", "| # | Status | Method | URL | Type | Time |", "|---|---|---|---|---|---|");
    requests.forEach((r, i) => md.push(`| ${i + 1} | ${r.status ?? (r.outcome === "failed" ? "(failed)" : "n/a")} | ${r.method ?? "n/a"} | ${escape(redactUrl(r.url).url)} | ${r.resourceType} | ${formatMs(r.durationMs)} |`));
  }
  const detailed = requests.length > 1 ? requests.filter((r) => r.outcome === "failed" || r.outcome === "http-error" || r.slow) : requests;
  if (detailed.length) md.push("", requests.length > 1 ? "## Problem details" : "## Request details");
  for (const r of detailed) {
    const u = urls(r);
    md.push("", `### ${escape(r.method ?? "")} ${escape(u.url)}`, "");
    md.push(`- **Outcome:** ${statusLine(r)}. ${describeOutcome(r)}`);
    if (r.errorText) md.push(`- **Error:** \`${r.errorText}\``);
    if (u.redirect) md.push(`- **Redirects to:** ${u.redirect}`);
    md.push(`- **Type:** ${typeLabel(r)}${r.mimeType ? ` (${r.mimeType})` : ""}`);
    md.push(`- **Started:** ${r.startedAt ?? "n/a"} · **Duration:** ${formatMs(r.durationMs)}${r.slow ? " (slow)" : ""}`);
    md.push(`- **Timing:** ${timingLine(r)}`);
    for (const f of analyze(r)) md.push(`- **${f.title}:** ${f.detail}`);
  }
  md.push("", "_n/a means DevTools did not report the value._", "");
  return { format, filename, mime: "text/markdown", content: md.join("\n") };
}
