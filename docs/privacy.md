# Data handling (plan step 5)

## What the extension can access

- **Permissions requested: none.** The manifest declares only a `devtools_page`. The extension runs only while DevTools is open. It has no content scripts, no background worker and no host permissions.
- **Data read:** request metadata from `chrome.devtools.network` (the same log the Network panel shows): URL, method, status, resource type, MIME type, timings, transfer size, cache source, protocol, server IP and Chrome's error text.
- **Never read:** response bodies. The code never calls `getContent()`. Headers and cookies are present in the HAR entries Chrome passes in, but they are not copied into the extension's own data model or shown.

## Where data goes

- Nowhere. Everything is processed in memory inside the DevTools panel. Request data is never written to disk or browser storage. The only exception is a report the user explicitly downloads.
- **Local preferences** (`localStorage`, in this extension's own origin only):
  - the theme choice
  - up to 4 pinned commands
  - per-command usage counts, stored by command name only (e.g. `"/show": 3`)

  Pins are allowed only for commands with fixed arguments, so typed search text, row numbers and anything taken from a request are never stored. Usage counts can be deleted with **⋯ → Reset command usage** or `/reset-usage`.
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
- **Query and fragment values are hidden by default.** A value is shown only when its parameter name is on a short allowlist of harmless names (pagination, sorting, language, format, view and UTM campaign names, such as `page`, `limit`, `offset`, `sort`, `order`, `lang`, `locale`, `format`, `v`, `view`, `tab`). The value must also be short and plain: up to 40 letters, digits or `_.,:-`. Free text such as `q=`, IDs, and any unknown name such as `t=` are hidden. Parameter names stay visible.
- Names that look sensitive are always hidden, even if allowlisted. That means names containing any of: token, secret, passw, pwd, pw, auth, session, sess, sid, key, sig, code, credential, jwt, bearer, otp, nonce, state, cookie, email, phone, ssn, card, account, login, user, pass.
- Parameter values and path segments that look like a JWT (`eyJ…`), an opaque token (32+ URL-safe characters) or an email address are redacted whatever the parameter name.
- `data:` and `blob:` URLs are replaced by a placeholder, and unparseable URLs are replaced entirely.

The rules lean towards over-redaction: a report that hides a harmless value is acceptable, one that leaks a token is not. Query values are covered by the default-deny rule. Path segments are kept for debugging, so a secret of ordinary length placed directly in a path segment is not detected. Review a report before sharing it outside your team.

## In the inspector (display masking)

The same redaction is applied wherever a URL is **displayed**:

- the request list, including row tooltips
- the details pane (URL and redirect target)
- the initiator location
- console output such as `/slowest`

Masking changes only the display. The captured request is never modified.

- **Reveal** (next to a masked URL, shown with "N hidden") is a deliberate per-request action. It shows the original value and resets as soon as another request is selected.
- **Copy URL** copies the **masked** URL by default. Only after Reveal does the button change to **Copy original URL**, and its confirmation says the copied text contains unredacted values.
- **Search** matches the masked URL, so typing a secret value can't be used to locate the request that contains it. Parameter names stay searchable.
- **Show in Network panel** passes only the URL path as the Network filter, never query values.

## Downloads

**⋯ → Download Markdown/JSON** (all visible requests) and **Download** in the details pane (selected request) save a technical report through a standard browser download. It needs no `downloads` permission. These files use the same redaction and contain the same metadata as the copied report, plus the analysis. They never include headers, cookies or bodies.

## Console

The console runs only an allowlist of Quick Debug's own commands, with validated arguments. It never evaluates JavaScript, never runs shell commands, never reads page content and never executes text from a page, a response or a report. Commands use the same masking and redaction as the buttons; `/copy` and `/download` produce the redacted report. Command history is kept in memory only and is lost when DevTools closes.
