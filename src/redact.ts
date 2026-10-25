// URL redaction for reports, downloads and on-screen masking. Errs on the side of
// hiding too much: a report that hides a harmless value is fine; one that leaks a
// token is not.
//
// Query and fragment values are hidden by default. A value is shown only when its
// parameter name is on a short allowlist of plainly harmless names (pagination,
// sorting, language, format...) AND the value itself does not look secret. A
// short secret under an innocent-looking name (e.g. `?t=abc123`) cannot be
// recognised by any pattern, so it is hidden by this default rather than by
// detection.

export const REDACTED = "[REDACTED]";

const SENSITIVE_NAME =
  /(token|secret|passw|pwd|pw|auth|session|sess|sid|key|sig|code|credential|jwt|bearer|otp|nonce|state|cookie|email|e-mail|phone|ssn|card|account|login|user|pass)/i;

const OPAQUE_VALUE = /^[A-Za-z0-9_\-.~+/=%]{32,}$/;
const JWT_LIKE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
/** An email address, wherever it appears (parameter value or path segment). */
const EMAIL_LIKE = /^[^\s@/?#]+@[^\s@/?#]+\.[A-Za-z]{2,}$/;

function secretLooking(value: string): boolean {
  return JWT_LIKE.test(value) || OPAQUE_VALUE.test(value) || EMAIL_LIKE.test(value);
}

/** Parameter names whose values are normally safe to show (compared case-insensitively). */
export const SAFE_PARAM_NAMES = new Set([
  "page", "per_page", "perpage", "page_size", "pagesize", "limit", "offset", "start", "count", "size",
  "sort", "sort_by", "sortby", "order", "order_by", "orderby", "dir", "direction",
  "lang", "language", "locale", "hl", "format", "fmt", "v", "ver", "version",
  "view", "tab", "mode", "theme", "include", "expand", "fields",
  "utm_source", "utm_medium", "utm_campaign",
]);

/** A value shown for an allowlisted name must also be short and plain. */
const PLAIN_VALUE = /^[A-Za-z0-9_.,:-]{1,40}$/;

export function isSensitiveParam(name: string, value: string): boolean {
  if (SENSITIVE_NAME.test(name) || secretLooking(value)) return true;
  return !(SAFE_PARAM_NAMES.has(name.toLowerCase()) && PLAIN_VALUE.test(value));
}

function redactParams(params: URLSearchParams): number {
  let count = 0;
  for (const [name, value] of [...params]) {
    if (value !== "" && isSensitiveParam(name, value)) {
      params.set(name, REDACTED);
      count++;
    }
  }
  return count;
}

export interface RedactionResult {
  url: string;
  redactions: number;
}

/**
 * Redact credentials, sensitive query/fragment parameters and opaque path tokens.
 * Unparseable input is replaced entirely rather than passed through.
 */
export function redactUrl(input: string | null): RedactionResult {
  if (input === null) return { url: "(not available)", redactions: 0 };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { url: REDACTED + " (unparseable URL)", redactions: 1 };
  }
  if (url.protocol === "data:" || url.protocol === "blob:") {
    return { url: `${url.protocol} URL (content omitted)`, redactions: 1 };
  }

  let redactions = 0;
  if (url.username || url.password) {
    url.username = "";
    url.password = "";
    redactions++;
  }

  const segments = url.pathname.split("/");
  const cleaned = segments.map((seg) => {
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      /* keep raw */
    }
    if (secretLooking(decoded)) {
      redactions++;
      return REDACTED;
    }
    return seg;
  });
  url.pathname = cleaned.join("/");

  const query = new URLSearchParams(url.search);
  const queryRedactions = redactParams(query);
  if (queryRedactions > 0) {
    redactions += queryRedactions;
    url.search = query.toString();
  }

  if (url.hash.length > 1) {
    const fragment = url.hash.slice(1);
    if (fragment.includes("=")) {
      const params = new URLSearchParams(fragment);
      const n = redactParams(params);
      if (n > 0) {
        redactions += n;
        url.hash = params.toString();
      }
    } else if (secretLooking(fragment)) {
      url.hash = REDACTED;
      redactions++;
    }
  }

  // URLSearchParams encodes the brackets; show the marker readably.
  const out = url.toString().replace(/%5BREDACTED%5D/g, REDACTED);
  return { url: out, redactions };
}
