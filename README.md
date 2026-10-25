# Quick Debug

A focused Chrome DevTools panel for finding and understanding network-request problems. It adds a compact view of what the page requested, what went wrong, and a redacted report you can paste into a bug ticket. It works alongside the native Network panel and does not replace it.

- **Local only.** No backend, no telemetry, and no extension permissions. The extension pages' content security policy blocks all network connections from its code (`connect-src 'none'`). The only outbound link is the optional **Reference (MDN)** link in the status help, which opens in a new tab when you click it.
- **Plain TypeScript, HTML and CSS.** No UI framework and no runtime dependencies.
- **Honest data.** A value DevTools didn't report is shown as `n/a`, never guessed. An HTTP 4xx/5xx is described as a server response, not as a confirmed bug.

## Install (unpacked)

Requires Node.js 22 (the version CI uses).

```
npm ci
npm run build          # outputs the unpacked extension to dist/ (about 160 KB, no external files)
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose `dist/`. Open DevTools on any page and select the **Quick Debug** tab. It may be under the `»` overflow menu.

## Using it

| Task | How | Clicks |
|---|---|---|
| See only problems (no response, 4xx/5xx, slow) | **Problems** | 1 |
| See requests with no response, HTTP errors, redirects or slow requests | the toolbar button (narrow panels: **Filters ▾** → item) | 1 (2) |
| Search URL, method, status, type or error | search box (`/` focuses it) | 1 |
| Filter by resource type | type picker (narrow: **Filters ▾** → picker) | 2 (3) |
| Inspect a request: status, analysis, timing, masked URL | click its row | 1 |
| What does this status/error mean? | row → **?** | 2 |
| Show the original URL (masked by default) | row → **Reveal** | 2 |
| Copy a redacted report | row → **Copy report** (or `c`) | 2 |
| Download a technical report (Markdown) | row → **Download** | 2 |
| Download a report of all visible requests | **⋯** → Download Markdown / JSON | 2 |
| Open the script that made the request | row → **Open in Sources** | 2 |
| Jump to the native Network panel | row → **Network panel** | 2 |
| Light / dark / automatic theme | **⋯** → Theme | 2 |
| Run a command | click the console (or `` ` ``), type, Enter | 1 |
| Capture everything from page start | **Reload to capture everything** | 1 |
| Clear the list (Network panel unaffected) | **Clear** | 1 |

Keyboard: `↑`/`↓` (or `j`/`k`), `Home` and `End` move through the list. `Esc` closes menus and details or clears the search. `/` focuses search, `` ` `` focuses the console and `c` copies the report.

### Analysis

Selecting a request shows what the captured data supports:

- the **likely source** (request, server, network, DNS, TLS, browser or extension), based on the status or Chrome's `net::ERR_*` code
- **where the time went** when one phase dominates (e.g. waiting for the first byte, or downloading)
- **what started the request** (parser, script, preload…), with a jump to the line in Sources

Nothing is guessed: phases DevTools didn't report are listed as such, and inconsistent timing data is shown and flagged.

### Console

A small command line at the bottom. It isn't a shell: it runs only these commands, and rejects anything else with an explanation.

`/help` · `/show all|problems|failed|errors|redirects|slow` · `/type <type>` · `/search [text]` · `/slowest [n]` · `/reset` · `/select <row>` · `/copy` · `/download [md|json] [all]` · `/explain <status|net::ERR_…>` · `/theme auto|light|dark` · `/pin <command>` · `/unpin <command>` · `/pins` · `/reset-usage` · `/clear` · `/cls` · `/spooky`

Pinned commands (up to 4) appear as one-click shortcuts. When nothing is pinned, up to two frequently used commands are suggested. Suggestions are computed when the panel opens, so they never move while you work.

### Adaptive layout

- **Wide panels** show every filter inline.
- **Below 760 px** the secondary filters move into **Filters ▾**, whose label shows any active hidden filter, and details stack under the list.
- **Below 560 px** the Method and Type columns and the shortcuts hide. Type stays visible in the details, and every command is still available.

### Halloween mode (through Nov 1, 2026)

Until **November 1, 2026 inclusive** (your local date), the accent turns purple, the console prompt turns orange, and a tiny spiderweb sits in the console corner. Status colours don't change. `/spooky` sends a small ghost across its own lane in the console log once, about 2.6 s, then removes it. With reduced motion it shows a still ghost instead. From November 2 everything returns to normal automatically, and `/spooky` reports that the season is over.

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
node scripts/make-icons.mjs   # re-render extension/icons/*.png from assets/icon.svg
```

Set `CHROMIUM_PATH=/path/to/chrome` to run `test:ui` or `test:integration` against a specific Chromium build. CI uses this to test Chromium 110, the declared minimum.

`test:ui` and `test:integration` need [Playwright](https://playwright.dev) with Chromium available (`npm i --no-save playwright@1.64.1 && npx playwright install chromium`, the version CI pins). It is a test tool only, not a project dependency.

### Layout

```
extension/   manifest.json, devtools.html, panel.html, panel.css, icons/ (copied to dist/)
assets/      icon.svg (icon source; not shipped)
src/
  model.ts     HAR entry → NormalizedRequest (missing values stay null; timing consistency check)
  explain.ts   status / net::ERR explanations and rule-based analysis
  commands.ts  console command allowlist and parser
  prefs.ts     local theme, pins and usage counts
  season.ts    Halloween date window
  spooky.ts    /spooky animation (isolated)
  filter.ts    status views, type and text filters, summary counts
  redact.ts    URL redaction (reports, downloads and on-screen masking)
  report.ts    diagnostic report text
  format.ts    display helpers
  store.ts     in-memory request store, ordered like the Network panel (start time, then DevTools log order), de-duplicated
  capture.ts   chrome.devtools.network → store (getHAR reconcile + live events)
  panel.ts     the panel UI (plain DOM)
  devtools.ts  registers the panel
test-pages/  server producing successes, 4xx/5xx, dropped and blocked requests, redirects, a slow response
tests/       unit tests, UI test, real-DevTools integration test
docs/        use cases, research, privacy, test report
```

## Beta limitations

- **Distribution:** unpacked, for testers only. It is not on the Chrome Web Store. The icon set (16–128 px) is in place; a store listing would still need screenshots, a privacy disclosure and a review. Beta testers: see [docs/beta-testing.md](docs/beta-testing.md).
- **Browser versions:** tested in real DevTools on Chromium 110 (the declared minimum), 153 and 156. CI runs the UI and real-DevTools tests on 110 and 156. **Show in Network panel** needs `chrome.devtools.panels.network.show`. That API is absent in Chrome 110, so the button is hidden there; it is present in 153 and 156.
- **Redaction** hides every query and fragment value unless the parameter name is on a short allowlist of harmless names (`page`, `limit`, `sort`, `lang`, `format`…) and the value is short and plain. Path segments are kept unless they look like a token or an email address, so a secret placed directly in a path segment of ordinary length is not detected. Review a report before sharing it outside your team.
- **Analysis:** the "likely source" is a rule-based reading of status and error codes, not a diagnosis.
- **Capture:** requests that never finish are not listed (use the Network panel for those), and behaviour with Network → "Preserve log" turned on is untested.
- **Halloween mode** (accents and `/spooky`) switches itself off after November 1, 2026.
- **No beta feedback yet:** usability against the native Network panel has not been measured with real users.

## License

[MIT](LICENSE).

## Status

This is the MVP described in the implementation plan: steps 1–6 are done and step 7 is partly done (performance measured). The small beta (step 7) and the expansion decision (step 8) need real users, so they haven't started. See [docs/test-report.md](docs/test-report.md) for what has been verified and what hasn't, and [docs/research.md](docs/research.md) for the evidence behind the phase-2 features.
