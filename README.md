# Quick Debug

A focused Chrome DevTools panel for finding and understanding network-request problems. It adds a compact view of what the page requested, what went wrong, and a redacted report you can paste into a bug ticket. It works alongside the native Network panel and does not replace it.

- **Local only.** No backend, no telemetry, and no extension permissions. The extension pages' content security policy blocks all network connections (`connect-src 'none'`).
- **Plain TypeScript, HTML and CSS.** No UI framework and no runtime dependencies.
- **Honest data.** A value DevTools didn't report is shown as `n/a`, never guessed. An HTTP 4xx/5xx is described as a server response, not as a confirmed bug.

## Install (unpacked)

```
npm install
npm run build          # outputs the extension to dist/
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose `dist/`. Open DevTools on any page and select the **Quick Debug** tab. It may be under the `»` overflow menu.

## Using it

| Task | How | Clicks |
|---|---|---|
| See only problems (no response, 4xx/5xx, slow) | **Problems** | 1 |
| See requests with no response, HTTP errors, redirects or slow requests | the matching button in the toolbar | 1 |
| Search by URL, method, status, type or error text | type in the search box (`/` focuses it) | 1 |
| Filter by resource type | type picker | 2 |
| Inspect a request | click its row | 1 |
| Copy a redacted diagnostic report | row → **Copy report** (or press `c`) | 2 |
| Copy the full, unredacted URL | row → **Copy URL** | 2 |
| Jump to the native Network panel, filtered to this request | row → **Show in Network panel** | 2 |
| Capture everything from page start | **Reload page to capture everything** (shown when the capture may be partial) | 1 |
| Clear the list (doesn't affect the Network panel) | **Clear** | 1 |

Keyboard: `↑`/`↓` (or `j`/`k`), `Home` and `End` move through the list. `Esc` closes the details or clears the search. `/` focuses search, and `c` copies the report for the selected request.

The request list stays visible while details are open, and a selected request keeps its details open even if a filter hides its row.

### What counts as a problem

| Label | Meaning |
|---|---|
| **No response** | Chrome got no HTTP response. The request may have failed, been blocked or been cancelled. Chrome's error text (e.g. `net::ERR_EMPTY_RESPONSE`) is shown when available. |
| **HTTP error** | The server answered with 4xx or 5xx. This can still be expected behaviour, such as a 401 before login. |
| **Slow** | It took 1 second or longer in total. |
| **Redirect** | 301, 302, 303, 307 or 308. A 304 Not Modified counts as a success because the cached copy was used. |

## How capture works

DevTools only records requests while it's open. Quick Debug reads the same log as the Network panel:

- **`chrome.devtools.network.getHAR`** is the source of truth. It's read when the panel opens, shortly after each event, and in the background (every 2 s, backing off on large logs, paused while the panel is hidden).
- **`onRequestFinished`** makes new requests appear immediately. In Chrome it does **not** fire for every request (for example, fetches whose body the page never reads). The `getHAR` reconcile catches those.
- Requests that are still in flight are left out until they finish, so they are never shown as failures.
- Until a navigation is seen, the panel says the capture may be partial and offers a one-click reload.
- On navigation the list starts over, like the Network panel without "Preserve log".

## Privacy

See [docs/privacy.md](docs/privacy.md). In short: everything stays inside DevTools. Reports contain request metadata only, never headers, cookies or bodies, and sensitive URL values are redacted by default.

## Development

```
npm run typecheck      # strict TypeScript, src and tests
npm test               # unit tests (Node test runner): model, filters, redaction, report, store, capture
npm run test:ui        # built panel in Chromium with a fake chrome.devtools; click-depth audit; 5,000-request timing
npm run test:integration   # real Chromium DevTools against the test page (needs a display, e.g. xvfb-run -a)
npm run testpages      # controlled test page on http://127.0.0.1:8787/
```

`test:ui` and `test:integration` need [Playwright](https://playwright.dev) with Chromium available (`npm i --no-save playwright && npx playwright install chromium`). It is a test tool only, not a project dependency.

### Layout

```
extension/   manifest.json, devtools.html, panel.html, panel.css (copied to dist/)
src/
  model.ts     HAR entry → NormalizedRequest (missing values stay null)
  filter.ts    status views, type and text filters, summary counts
  redact.ts    URL redaction for reports
  report.ts    diagnostic report text
  format.ts    display helpers
  store.ts     in-memory request store, ordered by start time, de-duplicated
  capture.ts   chrome.devtools.network → store (getHAR reconcile + live events)
  panel.ts     the panel UI (plain DOM)
  devtools.ts  registers the panel
test-pages/  server producing successes, 4xx/5xx, dropped and blocked requests, redirects, a slow response
tests/       unit tests, UI test, real-DevTools integration test
docs/        use cases, privacy, test report
```

## Status

This is the MVP described in the implementation plan: steps 1–6 are done and step 7 is partly done (performance measured). The small beta (step 7) and the expansion decision (step 8) need real users, so they haven't started. See [docs/test-report.md](docs/test-report.md) for what has been verified and what hasn't.
