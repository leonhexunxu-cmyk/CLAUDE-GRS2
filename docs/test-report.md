# Test report (plan steps 2, 6 and 7)

Environment: Chromium 153.0.8010.12 (Playwright build) on Linux, under Xvfb; Node 22.

## How it was tested

| Suite | Command | What it covers | Result |
|---|---|---|---|
| Unit | `npm test` | Data layer (normalization, missing values, malformed input, outcome classification), filters and counts, redaction, report text, store ordering and de-duplication, and capture/reconcile logic with fake timers. | 35/35 pass |
| UI | `npm run test:ui` | The built panel in Chromium with a fake `chrome.devtools` API: every feature driven by real clicks, keyboard navigation, live and reconcile-only requests, Clear and navigation, clipboard contents, and no console errors. | pass |
| Integration | `npm run test:integration` (under `xvfb-run`) | The **real extension in real DevTools**: loads `dist/`, opens the Quick Debug panel, loads `test-pages/`, reloads, then compares every row against `chrome.devtools.network.getHAR` (URL, method, status, type, order), plus counts, error texts, redaction and the Network-panel hand-off. | pass (repeated runs) |

The controlled test page (`npm run testpages`) produces 17 requests: document, stylesheet, script and images; 200, 201 (POST), 302 and the redirected 200; 401, 404 (twice) and 500, 503; a 1.5 s response; a dropped connection (`net::ERR_EMPTY_RESPONSE`); a port Chrome blocks (`net::ERR_UNSAFE_PORT`); and a URL carrying an `access_token`.

Observed in real DevTools after a reload: 17 of 17 requests shown, matching `getHAR`. Counts: Problems 8, No response 2, HTTP errors 5, Redirects 1, Slow 1. The partial-capture notice was shown before the reload and gone after it.

## Defects found and fixed during testing

| # | Found by | Defect | Fix |
|---|---|---|---|
| 1 | Real DevTools | `onRequestFinished` fired for only 8 of 17 requests. It never fired for fetches whose response body the page didn't read, so those requests were silently missing. | `getHAR` is now the source of truth, reconciled after events and in the background. `onRequestFinished` is only the fast path. |
| 2 | Real DevTools | `getHAR` includes in-flight requests (status 0, time 0, no error). These would have been shown as "No response". | Unfinished entries are skipped until they complete. |
| 3 | Real DevTools | Rows appeared in arrival order, so reconciled requests landed at the end. Native DevTools orders by start time. | The store keeps requests sorted by start time. |
| 4 | UI performance sample | Loading 5,000 requests took 1,890 ms, about 380 ms of it in table layout. | Flex rows with `content-visibility: auto` (ARIA grid roles keep the table semantics). Now about 450 ms. |
| 5 | Real DevTools screenshot | The root document showed its host twice. | The host is hidden when it equals the name. |

## Feature-access audit (three-click rule)

Measured by `test:ui`, which counts the clicks it actually performs from the main view. All features are within the limit.

| Feature | Clicks |
|---|---|
| Show problems / no response / HTTP errors / redirects / slow / all | 1 each |
| Search by text | 1 (focus the box; `/` also works) |
| Filter by resource type | 2 |
| Inspect a request | 1 |
| Copy diagnostic report | 2 |
| Copy full URL | 2 |
| Preview report | 2 |
| Show request in native Network panel | 2 |
| Close details | 2 (from a fresh view; 1 when details are already open) |
| Reload for a complete capture | 1 |
| Clear list | 1 |

## Performance (step 7, measured)

From `test:ui`, 5,000 requests fed through the live event path in one burst:

| Measure | Result |
|---|---|
| Ingest + first paint of 5,000 rows | ~450 ms (one burst; real pages spread this over the page's lifetime) |
| Switch to Problems view (DOM update) | ~15–20 ms |
| Switch back to All (DOM update) | ~15 ms |
| JS heap after GC with 5,000 requests | ~5 MB |

Background reconcile: `getHAR` runs every 2 s while the panel is visible. The interval grows to 20× the last `getHAR` duration on large logs, which caps the reconcile at about 5% of wall time.

## Not verified yet

- **Usability with real developers.** Task-completion time, click count against existing workflows, and error rates need the step-7 beta. Nothing here measures them.
- **Network-panel hand-off on older Chrome.** The button uses `chrome.devtools.panels.network.show`. It is hidden when that API is missing, but the hand-off was only exercised on Chromium 153.
- **"Preserve log" interaction.** With "Preserve log" on, `getHAR` keeps old pages' requests and Quick Debug shows them after a navigation, as the Network panel does. This is reasoned from the API but not tested.
- **Requests from an old page that finish after a navigation** can appear in the new list through `onRequestFinished`.
- **Service-worker, WebSocket and very long-lived requests.** These aren't in the test page. Requests that never finish are not shown (open the Network panel for those).
- **Firefox** has not been evaluated (plan step 8).
