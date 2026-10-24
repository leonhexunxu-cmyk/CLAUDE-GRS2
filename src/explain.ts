// Plain-language help for HTTP status codes and Chrome network errors, plus a
// rule-based analysis of one request. Every statement is derived from fields
// DevTools reported; the analysis says "likely" where it infers a cause and
// never claims a defect it cannot see.
import { ADDITIVE_PHASES, type NormalizedRequest, type TimingPhase } from "./model.js";
import { formatBytes, formatMs } from "./format.js";
import { redactUrl } from "./redact.js";

export interface CodeHelp {
  code: string;
  title: string;
  meaning: string;
  /** What to look at next. */
  check: string;
  /** Reference page, opened only if the user clicks it. */
  reference?: string;
}

type Entry = [title: string, meaning: string, check: string];

const STATUS: Record<number, Entry> = {
  100: ["Continue", "The server received the request headers and the client may send the body.", "Normally invisible; only relevant if a client uses Expect: 100-continue."],
  101: ["Switching Protocols", "The server agreed to switch protocols, usually to WebSocket.", "Expected for WebSocket handshakes."],
  103: ["Early Hints", "The server sent preliminary headers (often preload links) before the final response.", "Informational; the final status follows."],
  200: ["OK", "The request succeeded and the response contains the result.", "If the page still misbehaves, check the response content in the Network panel."],
  201: ["Created", "The request succeeded and created a new resource.", "Usually the answer to a POST or PUT."],
  202: ["Accepted", "The server accepted the request but has not finished processing it. The work happens later, so success is not yet guaranteed.", "Not an error. If the page expects a result, check how it learns that the job finished (polling, webhook, status endpoint)."],
  203: ["Non-Authoritative Information", "The response was modified by a proxy between you and the origin server.", "Check for proxies or transforming CDNs."],
  204: ["No Content", "The request succeeded and there is intentionally no response body.", "Code that tries to parse a body from a 204 will fail."],
  206: ["Partial Content", "The server returned only part of the resource, as asked by a Range header.", "Normal for media streaming and resumable downloads."],
  300: ["Multiple Choices", "Several representations are available; the client should pick one.", "Rare in practice; check the Location or response body."],
  301: ["Moved Permanently", "The resource has a new permanent URL. Browsers may cache this redirect.", "Update links to the new URL; a cached 301 can outlive a server change."],
  302: ["Found", "Temporary redirect to another URL.", "Common after logins or for short-lived moves; check the redirect target."],
  303: ["See Other", "Redirect to another URL to be fetched with GET, typically after a form POST.", "Expected after form submissions."],
  304: ["Not Modified", "The cached copy is still valid, so the server sent no body and the browser reused its cache.", "Not an error. If stale content appears, check the cache headers."],
  307: ["Temporary Redirect", "Temporary redirect that keeps the original method and body.", "Check the redirect target."],
  308: ["Permanent Redirect", "Permanent redirect that keeps the original method and body.", "Update links to the new URL."],
  400: ["Bad Request", "The server could not process the request because something in it was malformed or invalid.", "Compare the request URL, parameters and payload with what the API expects."],
  401: ["Unauthorized", "The request needs valid authentication, and none (or an invalid one) was provided.", "Expected before login. Otherwise check that the session or token is present and not expired."],
  402: ["Payment Required", "Reserved; some APIs use it for billing or quota problems.", "Check the API provider's documentation."],
  403: ["Forbidden", "The server understood who you are but refuses access.", "Check permissions, roles, CSRF tokens or IP/region restrictions."],
  404: ["Not Found", "The server has nothing at this URL.", "Check the URL for typos, a wrong base path or a removed resource. Can be expected for optional resources."],
  405: ["Method Not Allowed", "The URL exists but does not accept this HTTP method.", "Check the method (GET/POST/PUT…) against the API."],
  406: ["Not Acceptable", "The server cannot produce a response matching the Accept headers.", "Check Accept / Accept-Language headers."],
  407: ["Proxy Authentication Required", "A proxy between you and the server needs authentication.", "Check proxy settings."],
  408: ["Request Timeout", "The server gave up waiting for the request.", "Check for slow uploads or idle connections."],
  409: ["Conflict", "The request conflicts with the current state of the resource (for example, an edit conflict).", "Reload the resource state and retry."],
  410: ["Gone", "The resource was removed on purpose and will not come back.", "Remove references to it."],
  411: ["Length Required", "The server requires a Content-Length header.", "Check how the request body is sent."],
  412: ["Precondition Failed", "A conditional header (If-Match, If-Unmodified-Since) did not match.", "The resource changed; refetch before updating."],
  413: ["Content Too Large", "The request body is larger than the server accepts.", "Reduce the upload size or raise the server limit."],
  414: ["URI Too Long", "The URL is longer than the server accepts.", "Move large parameters into a request body."],
  415: ["Unsupported Media Type", "The server does not accept the request body's format.", "Check the Content-Type header."],
  416: ["Range Not Satisfiable", "The requested byte range is outside the resource.", "Check Range headers."],
  418: ["I'm a teapot", "A joke status from RFC 2324; some servers use it to refuse requests.", "Check the server's documentation."],
  421: ["Misdirected Request", "The request reached a server that cannot answer for this host.", "Often an HTTP/2 connection-reuse or TLS certificate issue on the server side."],
  422: ["Unprocessable Content", "The request was well-formed but its content failed validation.", "Read the response body for validation errors."],
  425: ["Too Early", "The server refuses to process a request that might be replayed (TLS early data).", "Retry without early data."],
  426: ["Upgrade Required", "The server requires a different protocol.", "Check the Upgrade header in the response."],
  428: ["Precondition Required", "The server requires a conditional request.", "Send If-Match or similar headers."],
  429: ["Too Many Requests", "Rate limiting: the client sent too many requests in a given time.", "Check the Retry-After header and reduce request frequency."],
  431: ["Request Header Fields Too Large", "Headers, often cookies, are too large.", "Check for oversized or accumulated cookies."],
  451: ["Unavailable For Legal Reasons", "Access is denied for legal reasons.", "Not a technical fault."],
  500: ["Internal Server Error", "The server hit an unexpected condition.", "Check server logs around this request's time."],
  501: ["Not Implemented", "The server does not support this functionality.", "Check the method and endpoint."],
  502: ["Bad Gateway", "A gateway or proxy got an invalid response from the upstream server.", "Check the upstream service and proxy logs."],
  503: ["Service Unavailable", "The server is temporarily unable to handle the request (overload or maintenance).", "Check Retry-After, service health and deployments."],
  504: ["Gateway Timeout", "A gateway or proxy did not get a timely response from upstream.", "Check upstream latency and proxy timeouts."],
  505: ["HTTP Version Not Supported", "The server does not support the HTTP version used.", "Check protocol configuration."],
  507: ["Insufficient Storage", "The server cannot store what is needed to complete the request.", "Check server disk/quota."],
  508: ["Loop Detected", "The server detected an infinite loop while processing.", "Check server configuration."],
  511: ["Network Authentication Required", "The network (often a captive portal) needs you to authenticate.", "Log in to the network."],
};

const STATUS_CLASS: Record<number, Entry> = {
  1: ["Informational", "An interim response; the final status follows.", "Usually needs no action."],
  2: ["Success", "The request succeeded.", "Check the content if the page still misbehaves."],
  3: ["Redirection", "The client must go to another URL or use its cache.", "Check the redirect target."],
  4: ["Client error", "The server rejected the request as sent.", "Compare the request with what the server expects."],
  5: ["Server error", "The server failed to handle a valid-looking request.", "Check server logs."],
};

export type SourceKind = "request" | "server" | "network" | "dns" | "tls" | "browser" | "cancelled" | "unknown";

export const SOURCE_LABEL: Record<SourceKind, string> = {
  request: "The request as sent (client side)",
  server: "The server or an upstream service",
  network: "The network connection",
  dns: "DNS (host name lookup)",
  tls: "TLS / certificate",
  browser: "The browser, an extension or a browser security policy",
  cancelled: "The page or browser cancelled the request",
  unknown: "Not determinable from the captured data",
};

const NET_ERRORS: Record<string, [SourceKind, string, string]> = {
  ERR_NAME_NOT_RESOLVED: ["dns", "The host name could not be resolved to an IP address.", "Check the host name for typos and that DNS is reachable."],
  ERR_NAME_RESOLUTION_FAILED: ["dns", "DNS resolution failed.", "Check network and DNS settings."],
  ERR_CONNECTION_REFUSED: ["server", "The server's machine was reached but nothing accepted the connection on that port.", "Check that the service is running and listening on the expected port."],
  ERR_CONNECTION_RESET: ["network", "The connection was reset while in use.", "Check server crashes, proxies or firewalls dropping connections."],
  ERR_CONNECTION_CLOSED: ["server", "The connection was closed unexpectedly.", "Check server logs for crashes or limits."],
  ERR_CONNECTION_TIMED_OUT: ["network", "Connecting to the server took too long.", "Check that the host is reachable and not firewalled."],
  ERR_TIMED_OUT: ["network", "The operation timed out.", "Check server responsiveness and network quality."],
  ERR_EMPTY_RESPONSE: ["server", "The server closed the connection without sending any data.", "Check server logs; the process may have crashed or dropped the request."],
  ERR_ABORTED: ["cancelled", "The request was aborted, usually by the page (navigation, AbortController) rather than the network.", "Check whether the page cancelled it on purpose."],
  ERR_BLOCKED_BY_CLIENT: ["browser", "Blocked inside the browser, typically by an extension such as an ad or tracker blocker.", "Retry with extensions disabled (e.g. a guest profile)."],
  ERR_BLOCKED_BY_RESPONSE: ["browser", "Blocked because of the response's headers (for example Cross-Origin-Resource-Policy or framing rules).", "Check CORP/COEP/X-Frame-Options headers and the Issues panel."],
  ERR_BLOCKED_BY_ORB: ["browser", "Blocked by Opaque Response Blocking: a cross-origin response of a type the request should not receive.", "Check the response Content-Type and how the resource is requested."],
  ERR_UNSAFE_PORT: ["browser", "Chrome refuses to connect to this port because it is reserved for other protocols.", "Use a different port."],
  ERR_INTERNET_DISCONNECTED: ["network", "The device is offline.", "Check the connection or DevTools offline throttling."],
  ERR_ADDRESS_UNREACHABLE: ["network", "The IP address cannot be reached.", "Check routing, VPN and firewall."],
  ERR_NETWORK_CHANGED: ["network", "The network changed during the request.", "Retry; common when switching Wi-Fi or VPN."],
  ERR_PROXY_CONNECTION_FAILED: ["network", "Could not connect to the configured proxy.", "Check proxy settings."],
  ERR_SSL_PROTOCOL_ERROR: ["tls", "The TLS handshake failed.", "Check the server's TLS configuration."],
  ERR_INSECURE_RESPONSE: ["tls", "The response was rejected as insecure (certificate problem).", "Check the certificate."],
  ERR_TOO_MANY_REDIRECTS: ["server", "The URL redirected too many times, usually a redirect loop.", "Follow the Location headers to find the loop."],
  ERR_HTTP2_PROTOCOL_ERROR: ["server", "The HTTP/2 stream failed with a protocol error.", "Often a server or proxy bug, or a response that was cut off."],
  ERR_QUIC_PROTOCOL_ERROR: ["network", "The HTTP/3 (QUIC) connection failed.", "Check UDP blocking by firewalls or proxies."],
  ERR_INVALID_RESPONSE: ["server", "The server sent a response Chrome could not parse.", "Check the server's raw response."],
  ERR_CONTENT_LENGTH_MISMATCH: ["server", "The body was shorter or longer than the Content-Length header said.", "Check compression or truncation on the server or proxy."],
  ERR_CACHE_MISS: ["browser", "The resource was required from cache but was not there (often a resubmitted form).", "Reload normally."],
  ERR_FAILED: ["browser", "A generic failure. For cross-origin fetches this is very often a CORS rejection.", "Check the Console and Issues panels for a CORS message."],
};

function normalizeErrorKey(text: string): string {
  return text.trim().replace(/^net::/, "").toUpperCase();
}

/** Help for a status code ("202") or a Chrome error ("net::ERR_FAILED" / "ERR_FAILED"). Null if unknown or malformed. */
export function explainCode(input: string): CodeHelp | null {
  const raw = input.trim();
  if (/^\d{3}$/.test(raw)) {
    const code = Number(raw);
    if (code < 100 || code > 599) return null;
    const exact = STATUS[code];
    const entry = exact ?? STATUS_CLASS[Math.floor(code / 100)];
    if (!entry) return null;
    return {
      code: raw,
      title: exact ? entry[0] : `${entry[0]} (${raw} is not a standard code)`,
      meaning: entry[1],
      check: entry[2],
      reference: exact ? `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/${code}` : undefined,
    };
  }
  if (!/^(net::)?ERR_[A-Z0-9_]+$/i.test(raw)) return null;
  const key = normalizeErrorKey(raw);
  const known = NET_ERRORS[key];
  if (known) return { code: `net::${key}`, title: SOURCE_LABEL[known[0]], meaning: known[1], check: known[2] };
  if (key.startsWith("ERR_CERT_")) {
    return { code: `net::${key}`, title: SOURCE_LABEL.tls, meaning: "The server's certificate was rejected (expired, wrong host, untrusted issuer or similar).", check: "Inspect the certificate in the Security panel." };
  }
  return null;
}

export function errorSource(errorText: string | null): SourceKind {
  if (!errorText) return "unknown";
  const key = normalizeErrorKey(errorText);
  if (NET_ERRORS[key]) return NET_ERRORS[key][0];
  if (key.startsWith("ERR_CERT_") || key.startsWith("ERR_SSL_")) return "tls";
  return "unknown";
}

export interface Finding {
  kind: "source" | "timing" | "initiator" | "note";
  title: string;
  detail: string;
}

const PHASE_TEXT: Partial<Record<TimingPhase, string>> = {
  blocked: "waiting before the request could be sent (browser queue, connection limits or priority). DevTools does not report why",
  dns: "looking up the host name (DNS)",
  connect: "setting up the connection (TCP and TLS)",
  send: "sending the request",
  wait: "waiting for the server's first byte (server processing time, TTFB)",
  receive: "downloading the response body",
};

/** Likely source of the problem, if the request has one. */
export function likelySource(req: NormalizedRequest): SourceKind | null {
  if (req.outcome === "failed") return errorSource(req.errorText);
  if (req.outcome === "http-error" && req.status !== null) return req.status >= 500 ? "server" : "request";
  return null;
}

/** Ordered findings for the details view and reports. Each is grounded in reported fields. */
export function analyze(req: NormalizedRequest): Finding[] {
  const findings: Finding[] = [];
  const source = likelySource(req);
  if (source) {
    const basis = req.outcome === "failed" ? (req.errorText ? `Chrome's error ${req.errorText}` : "the missing response (no reason was reported)") : `the ${req.status} status`;
    const help = req.outcome === "failed" && req.errorText ? explainCode(req.errorText) : req.status !== null ? explainCode(String(req.status)) : null;
    findings.push({
      kind: "source",
      title: `Likely source: ${SOURCE_LABEL[source]}`,
      detail: `Based on ${basis}.${help ? " " + help.check : ""}`,
    });
  }

  if (req.outcome === "failed" && (req.timings.wait === 0 || req.timings.wait === null)) {
    findings.push({ kind: "note", title: "No response phases", detail: "The request never got a response, so send/wait/receive did not happen (Chrome reports them as 0)." });
  }

  if (req.fromCache) {
    findings.push({ kind: "note", title: `Served from ${req.fromCache} cache`, detail: "No network transfer took place, so network timings do not apply." });
  } else if (req.durationMs !== null && req.timingCheck.phaseSum !== null && req.timingCheck.phaseSum > 0 && req.outcome !== "failed") {
    let top: TimingPhase | null = null;
    for (const p of ADDITIVE_PHASES) {
      const v = req.timings[p];
      if (v !== null && (top === null || v > (req.timings[top] ?? 0))) top = p;
    }
    const topMs = top ? req.timings[top] ?? 0 : 0;
    const share = topMs / req.timingCheck.phaseSum;
    if (top && share >= 0.5 && (req.slow || topMs >= 100)) {
      let detail = `${formatMs(topMs)} of ${formatMs(req.durationMs)} (${Math.round(share * 100)}%) was spent ${PHASE_TEXT[top]}.`;
      if (top === "receive" && req.transferSize !== null) detail += ` ${formatBytes(req.transferSize)} were transferred.`;
      if (top === "blocked" && req.queueingMs !== null) detail += ` Of that, ${formatMs(req.queueingMs)} was queueing.`;
      findings.push({ kind: "timing", title: req.slow ? "Why it was slow" : "Where the time went", detail });
    }
  }

  if (req.timingCheck.consistent === false && req.timingCheck.phaseSum !== null && req.durationMs !== null) {
    findings.push({
      kind: "note",
      title: "Timing data is inconsistent",
      detail: `DevTools reported a total of ${formatMs(req.durationMs)}, but the phases add up to ${formatMs(req.timingCheck.phaseSum)}. Both values are shown as reported.`,
    });
  }

  if (req.initiator) {
    const i = req.initiator;
    const where = i.url ? `${redactUrl(i.url).url}${i.lineNumber !== null ? `:${i.lineNumber + 1}` : ""}` : null;
    const label: Record<string, string> = { parser: "the HTML parser", script: "a script", preload: "a preload", redirect: "a redirect", other: "navigation or another browser action", preflight: "a CORS preflight" };
    findings.push({
      kind: "initiator",
      title: `Started by ${label[i.type] ?? i.type}`,
      detail: where ? `${i.functionName ? i.functionName + " in " : ""}${where}` : "DevTools did not report the location.",
    });
  }
  return findings;
}
