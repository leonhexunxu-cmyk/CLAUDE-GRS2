# Developer-demand research (phase 2)

Researched on 2026-10-24 with web search and page fetches from this session. **Limitations:** the Chromium issue tracker (issues.chromium.org) requires sign-in, so I couldn't read issue bodies, star counts or comments; issue numbers below come from Chrome's own release notes or from articles that cite them. Searches for Reddit threads returned no Reddit results, so Reddit is **not** represented. Chrome Web Store user counts are the store's own rounded figures on the date above. I have not run any survey or user interviews, and nothing here claims more demand than the sources show.

## Candidates

### 1. Explain what a status or network error means, and where the problem likely comes from

- **Problem.** A row says `202`, `(failed)` or `net::ERR_BLOCKED_BY_CLIENT`. The developer then has to look up what that means, whether it's a bug, and whether to look at the server, the network, the browser or their own request.
- **Evidence.**
  - Chrome added human-readable status text in DevTools 117 ([What's new in DevTools 117](https://developer.chrome.com/blog/new-in-devtools-117), crbug [1153956](https://crbug.com/1153956)). That shows the Chrome team itself saw demand for status explanations.
  - Robin Marx (Akamai) lists "reasons for queueing and stalling" as a top wish ([Web Performance Calendar, 13 Dec 2024](https://calendar.perfplanet.com/2024/top-8-things-i-want-in-the-devtools-network-panel/), citing crbug [41168149](https://issues.chromium.org/issues/41168149)). He notes the Timing tab says *that* a request stalled, not *why*.
  - Several vendors publish their own "what does stalled/queued mean" support pages: [Coder](https://kb.coder.com/articles/7614098537-understanding-and-troubleshooting-queued-or-stalled-network-requests), [FullStory](https://help.fullstory.com/hc/en-us/articles/360020623654), and a [Railway community thread](https://station.railway.com/questions/stalled-requests-984c8ca2).
  - The user of this project asked for it directly ("small help button… gives info about 202", "detailed analysis of problem and of problem source").
- **Native today.** Partly available. There's status text in a tooltip, and the Initiator column and tab exist. DevTools gives no explanation of `net::ERR_*` codes and no "likely source" summary. The initiator is a separate column you have to enable, or a separate tab ([Requestly guide](https://requestly.com/blog/chrome-developer-tools-network-tab/), [DebugBear](https://debugbear.com/docs/request-initiator-chain)).
- **Existing extensions.** None found that do this specifically.
- **Feasibility.** High. All data is already in the HAR entry: status, `_error`, `timings`, `_blocked_queueing` and `_initiator`. It needs no new permissions, and `chrome.devtools.panels.openResource` jumps to the initiating line.
- **Costs and risks.** A small static dictionary, no network calls. The main risk is overclaiming a cause, so the wording says "likely" and names its basis.
- **Clicks.** Select row (1), then "?" (2). The analysis is visible on selection (1).
- **Demand rating.** Moderate and documented: Chrome shipped a partial fix, an expert wishlist asks for more, and support documentation keeps being written. It is not shown by large vote counts.

### 2. Shareable, redacted technical report (copy and download)

- **Problem.** Sharing a failing request in a ticket risks leaking cookies, tokens or session IDs.
- **Evidence.**
  - Chrome changed HAR export to sanitized by default in Chrome 130 ([devtools-frontend commit](https://chromium.googlesource.com/devtools/devtools-frontend/+/acd96a60464188fbf7c4476ec883ec65bba3dfdf)). It now strips Cookie, Set-Cookie and Authorization headers.
  - Vendors still warn that sanitized HARs can contain secrets in URLs and bodies: [Cloudflare docs PR](https://github.com/cloudflare/cloudflare-docs/pull/18440/files), [Spectro Cloud](https://docs.spectrocloud.com/troubleshooting/generate-har-files/), [Duende](https://docs.duendesoftware.com/identityserver/troubleshooting/export-har-files/).
  - Guides on "Copy as cURL/fetch" note that it carries cookies and auth headers ([OpenReplay](https://blog.openreplay.com/de/api-anfragen-network-tab-kopieren/), [issoh.co.jp](https://www.issoh.co.jp/tech/details/12635/)).
  - A Firefox add-on exists to mask these headers ([ResReq](https://addons.mozilla.org/firefox/addon/resreq-request-response-copier/)).
- **Native today.** Partly available. The sanitized HAR is the whole log, unreadable for humans, and still includes URL tokens. Copy as cURL/fetch is unsanitized.
- **Value added.** A short, human-readable report for one request or the visible set. URL secrets are redacted, there are no headers or bodies, and the analysis is included.
- **Feasibility.** High. It uses a `Blob` download from the panel and needs no `downloads` permission (verified in real Chromium 153).
- **Clicks.** Row → Copy report / Download (2). ⋯ → Download Markdown/JSON for all visible requests (2).
- **Demand rating.** Moderate. The best evidence is a browser-vendor default change plus several vendor warnings.

### 3. GraphQL operation names instead of rows all called "graphql"

- **Problem.** Every GraphQL request shows up as the same `POST /graphql`, so finding an operation means opening each request.
- **Evidence.**
  - [GraphQL Network Inspector](https://chromewebstore.google.com/detail/ndlbedplllcgconngcnfmkadhokfaaln) has about 100,000 users and 135 ratings, and was updated June 2026 ([announcement](https://the-guild.dev/blog/announcing-graphql-network-inspector)).
  - Several smaller tools exist: [GraphQeLves](https://chromewebstore.google.com/detail/bobamnaafoflcfoheggclcpknfgheemo) (23 users), [GraphPeek](https://hunted.space/product/graphpeek) and [graphql-network](https://github.com/madzhup/graphql-network).
  - I found no Chromium issue.
- **Native today.** Missing in the Network panel. It is already solved well by a popular extension.
- **Feasibility.** Medium. It would need to read `request.postData`, a request body, which this project's privacy rules currently exclude. Even parsing only `operationName` changes the data-handling promise.
- **Clicks.** It would show in the Name column (0 extra clicks).
- **Demand rating.** Strong by install count, but already served. **Deferred.** Revisit only if users want it inside Quick Debug, and with an explicit, documented exception for reading `operationName`.

### 4. Compare (diff) two requests

- **Problem.** Spotting what differs between a working and a failing call.
- **Evidence.** Thin. There's the [diff-curl](https://www.npmjs.com/package/diff-curl) author's note that diffing in DevTools is hard, and two small extensions ("Network+" / "Network++" on [chromeboard](https://chromeboard.com/extension/network%20-onjfnhgdccnjjcgffkmhpjnedbapanch)), where the diff feature reads as planned rather than shipped.
- **Native today.** Missing.
- **Feasibility.** High for metadata (no new permissions). Diffing headers or bodies would conflict with the privacy rules.
- **Demand rating.** An interesting idea without verified demand. **Deferred.**

### 5. Per-request throttling or delay

- **Problem.** Simulating a single slow dependency.
- **Evidence.** It's item 1 in [Robin Marx's wishlist](https://calendar.perfplanet.com/2024/top-8-things-i-want-in-the-devtools-network-panel/) (a perf.now() idea board, votes not recorded).
- **Native today.** **Already available.** The Network panel offers "Throttle request" from a row's context menu, through the Request conditions drawer ([Chrome docs](https://developer.chrome.com/docs/devtools/network-request-blocking), updated 2026-01-07).
- **Feasibility for us.** Low and out of scope. It modifies traffic, which the plan excludes, and would need `declarativeNetRequest` or the `debugger` permission.
- **Decision.** Not built; it would duplicate native functionality.

### Also assessed: web scraping (asked for by the user)

- **Evidence.** Demand for scraping as a category is real. [Web Scraper](https://chromewebstore.google.com/detail/web-scraper-free-web-scra/jnhgnonknehpejjnehehllkliplmbmhn) has about 900,000 users, 1.1K ratings, and was updated July 2026.
- **Why not built.** Scraping is not a network-debugging task. It would read page content, which is a large privacy expansion, and it needs either `chrome.devtools.inspectedWindow.eval` or content scripts with host permissions. Mature extensions already serve it, and many sites' terms forbid it.
- **Possible future step.** A narrowly scoped debugging aid, such as "list the resources this page references but never loaded", could use data we already have. It needs its own proposal and evidence. **Deferred; not implemented.**

## Ranking

| Rank | Candidate | Demand evidence | Usefulness for this tool | Feasibility / effort | Privacy & security | Decision |
|---|---|---|---|---|---|---|
| 1 | Status/error explanation + likely source + initiator | Moderate (Chrome partial fix, expert wishlist, vendor docs, user request) | High: the core "understand the problem" goal | High / small | No new data, no permissions | **Implemented** |
| 2 | Redacted technical report download | Moderate (Chrome 130 default change, vendor warnings) | High: closes the "share safely" loop | High / small | Improves privacy; still no headers/bodies | **Implemented** |
| 3 | GraphQL operation names | Strong but already met by a 100k-user extension | Medium | Medium | Needs request-body access | Deferred |
| 4 | Request diff | Weak / unverified | Medium | High (metadata only) | Fine for metadata | Deferred |
| 5 | Per-request throttling | Real, but **native now** | n/a | Low (traffic modification) | New privileged permissions | Not built |
| — | Web scraping | Real for scraping, not for debugging | Low for this tool | Medium | Large expansion | Not built |

## A real OS terminal: feasibility note (not implemented)

The console in Quick Debug runs only its own allowlisted commands. A real shell (Bash, PowerShell or `cmd.exe`) cannot run inside an extension. It would require all of the following:

- a separately installed **native messaging host** (an executable plus a registry or manifest entry outside Chrome)
- the `nativeMessaging` permission
- a protocol between panel and host

Any page you inspect can put text in front of you, so the design would also need:

- strict command allowlisting on the host side
- per-command confirmation
- no forwarding of page or response content into commands
- signing and update channels for the host binary

That is a different security model from a no-permission DevTools panel, so I don't recommend it for this project without a concrete use case.
