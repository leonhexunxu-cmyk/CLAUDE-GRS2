// HAR entries shaped like what chrome.devtools.network reports.
export function harEntry(overrides: {
  url?: string;
  method?: string;
  status?: number;
  statusText?: string;
  time?: number;
  type?: string;
  mime?: string;
  error?: string;
  redirectURL?: string;
  started?: string;
  timings?: Record<string, number>;
} = {}): Record<string, unknown> {
  return {
    startedDateTime: overrides.started ?? "2026-10-24T12:00:00.000Z",
    time: overrides.time ?? 42,
    request: { method: overrides.method ?? "GET", url: overrides.url ?? "https://example.test/api/items", httpVersion: "http/1.1" },
    response: {
      status: overrides.status ?? 200,
      statusText: overrides.statusText ?? "OK",
      redirectURL: overrides.redirectURL ?? "",
      httpVersion: "http/1.1",
      content: { mimeType: overrides.mime ?? "application/json", size: 120 },
      _transferSize: 300,
      _error: overrides.error ?? null,
    },
    timings: overrides.timings ?? { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 0.2, wait: 30, receive: 2 },
    _resourceType: overrides.type ?? "fetch",
  };
}
