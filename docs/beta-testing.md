# Beta testing guide

Thank you for trying Quick Debug. This beta answers one question from the implementation plan: **can developers find and understand network-request problems faster, and with fewer clicks, than with the native Network panel alone?** Your timings and honest friction reports matter more than praise.

## Install (about 2 minutes)

1. Get the build: clone the repository and run `npm ci && npm run build`. Node.js 22 is required.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `dist/` folder.
3. Open DevTools on any page and select **Quick Debug**. It may be under the `»` overflow menu.

Supported: Chrome 110 or newer. On Chrome versions without `chrome.devtools.panels.network.show`, the **Network panel** button is hidden.

## Tasks (about 15 minutes)

Use a site you work on, or the bundled test page (`npm run testpages`, then open http://127.0.0.1:8787/). For each task, note roughly how long it took and how many clicks it needed, first with Quick Debug and then with the native Network panel alone.

1. Find every request that failed or returned an error.
2. For one failed request, say whether the problem is more likely the request, the server, the network or the browser.
3. Find the slowest request and say which phase took the time.
4. Find which script started a given request.
5. Share one failing request with a colleague without exposing tokens. Check the copied or downloaded report yourself before sending it.

## What to report

Open a **Beta feedback** issue in the repository. The form asks for:

- Chrome version and OS
- task timings and clicks, Quick Debug vs. native
- anything wrong: a wrong count, a misleading explanation, missing requests, or a value that differs from the Network panel
- anything confusing or hard to find

**Privacy:** never paste an unredacted URL, header, cookie or token into an issue. Use **Copy report** (redacted), and re-read it first.

## Known limitations

See "Beta limitations" in the README.
