// URL redaction for diagnostic reports. Errs on the side of hiding too much:
// a report that hides a harmless value is fine; one that leaks a token is not.

export const REDACTED = "[REDACTED]";

const SENSITIVE_NAME =
  /(token|secret|passw|pwd|auth|session|sess|sid|key|sig|code|credential|jwt|bearer|otp|nonce|state|cookie|email|e-mail|phone|ssn|card|account|login|user|pass)/i;

const OPAQUE_VALUE = /^[A-Za-z0-9_\-.~+/=%]{32,}$/;
const JWT_LIKE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

export function isSensitiveParam(name: string, value: string): boolean {
  return SENSITIVE_NAME.test(name) || JWT_LIKE.test(value) || OPAQUE_VALUE.test(value);
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
    if (OPAQUE_VALUE.test(decoded) || JWT_LIKE.test(decoded)) {
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
    } else if (OPAQUE_VALUE.test(fragment) || JWT_LIKE.test(fragment)) {
      url.hash = REDACTED;
      redactions++;
    }
  }

  // URLSearchParams encodes the brackets; show the marker readably.
  const out = url.toString().replace(/%5BREDACTED%5D/g, REDACTED);
  return { url: out, redactions };
}
