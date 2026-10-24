# Data handling (plan step 5)

## What the extension can access

- **Permissions requested: none.** The manifest declares only a `devtools_page`. The extension runs only while DevTools is open. It has no content scripts, no background worker and no host permissions.
- **Data read:** request metadata from `chrome.devtools.network` (the same log the Network panel shows): URL, method, status, resource type, MIME type, timings, transfer size, cache source, protocol, server IP and Chrome's error text.
- **Never read:** response bodies. The code never calls `getContent()`. Headers and cookies are present in the HAR entries Chrome passes in, but they are not copied into the extension's own data model or shown.

## Where data goes

- Nowhere. Everything is processed in memory inside the DevTools panel, and nothing is written to disk or browser storage.
- The extension pages' content security policy is `script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'`. That stops the panel from making any network connection, even by mistake.
- No telemetry, analytics, accounts or remote code.
- Closing DevTools discards everything.

## Diagnostic reports

**Copy report** puts plain text on the clipboard only when the user clicks it (or presses `c`). The report contains:

- method and URL, with redaction applied (below)
- status, outcome and a plain-language meaning
- Chrome's error text, if any
- redirect target, with redaction applied
- resource type, MIME type, start time, duration, timing phases, transfer size, cache source and protocol
- whether the capture was complete or partial, and how many values were redacted

It **never** contains request or response headers, cookies, request or response bodies, or the server IP.

### URL redaction

Applied to the request URL and the redirect target in every report:

- `user:password@` credentials are removed.
- Query and fragment parameters are replaced with `[REDACTED]` when the **name** looks sensitive. That means names containing any of: token, secret, passw, pwd, auth, session, sess, sid, key, sig, code, credential, jwt, bearer, otp, nonce, state, cookie, email, phone, ssn, card, account, login, user, pass.
- Parameter values and path segments that look like a JWT (`eyJ…`) or an opaque token (32+ URL-safe characters) are redacted whatever the parameter name.
- `data:` and `blob:` URLs are replaced by a placeholder, and unparseable URLs are replaced entirely.

The rules lean towards over-redaction (e.g. `country_code` is redacted too). A report that hides a harmless value is acceptable; one that leaks a token is not. Redaction is pattern-based, so it can't promise to catch every secret. Review a report before sharing it outside your team.

**Copy URL** copies the full, unredacted URL. It is a separate button labelled as such, and its confirmation says "not redacted".
