# Use cases and baseline criteria (plan step 1)

## Representative debugging tasks

These are the tasks the MVP is built and tested against, in priority order. Each one is also a step in the integration test or the UI test.

| # | Task | Native DevTools today | Quick Debug |
|---|---|---|---|
| 1 | "Something on this page failed. Which requests?" | Network panel: scan the status column, or type `-status-code:200` style filters, or sort by status. Failed (no response) and 4xx/5xx are mixed with everything else. | **Problems** shows failures, HTTP errors and slow requests together, with a count on the button (1 click). |
| 2 | "Did this request get any response at all, or did it fail in the network?" | Status `(failed)` plus the reason hidden in a tooltip or the Headers tab. | Shown as **No response** with Chrome's error text in plain words. |
| 3 | "Is this 4xx a bug?" | No guidance. | Says what the status means and that a 4xx can be expected (e.g. 401 before login). It doesn't claim a defect. |
| 4 | "Why is this request slow?" | Timing tab, one more click after selecting. | The timing breakdown is in the details as soon as the request is selected; phases DevTools didn't report show as `n/a`. |
| 5 | "Send this to a colleague / paste it in a ticket." | Copy as cURL or HAR, both of which can include cookies, auth headers and tokens. | **Copy report**: metadata only, with sensitive URL values redacted (2 clicks). |
| 6 | "Find the request to `/api/orders`." | Network filter box. | Search box (`/`), matching URL, method, status, type and error text. |
| 7 | "I need the full tool now." | — | **Show in Network panel** opens the native panel filtered to the request. |

## Baseline usability criteria

- Every feature is reachable in at most three clicks from the main Quick Debug view; frequent ones take one.
- The panel helps with no setup: the problem count is visible immediately, with no filters to configure first.
- The list stays visible while a request is inspected, so the user doesn't lose their place.
- No value is invented: anything DevTools didn't report reads `n/a`.
- A partial capture is stated, with a one-click way to get a complete one.
- Reports never include headers, cookies or bodies, and redact sensitive URL values.

## Out of scope for the MVP

AI diagnoses, automatic fixes, blocking or modifying traffic, replacing the Network or Console panels, accounts, sync, telemetry, and browsers other than Chrome.
