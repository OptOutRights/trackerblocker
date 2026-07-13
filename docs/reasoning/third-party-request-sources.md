# Third-Party Request Sources

This note maps the places third-party requests and tracker signals can come from, how a Firefox WebExtension can intercept or observe them, and what TrackerBlocker currently does.

The goal is completeness for future blocking improvements, not claiming every source should be blocked immediately. The MVP should stay local-first, cautious, and explainable.

Inspection note: "Inspecting the page" means using Firefox DevTools on the page: Inspector, Network, Storage, Console, and related panels. Page inspection can reveal many visible requests, markup-driven sources, headers, and storage entries, but it cannot reliably show every cause. Browser-owned requests, DNS/CNAME details, service-worker cache hits, preconnects, extension-internal messages, and some initiator chains need browser/extension hooks or separate diagnostics.

## Current Interception Baseline

- Manifest permissions: `webRequest`, `webRequestBlocking`, `activeTab`, `storage`, and `<all_urls>` host permissions.
- Network hook: `browser.webRequest.onBeforeRequest` with `["blocking"]`.
- Lifecycle hooks: `onBeforeRedirect`, `onCompleted`, and `onErrorOccurred` update local request lifecycle evidence by Firefox `requestId`.
- Restrict hook: `onBeforeSendHeaders` strips outgoing `Cookie` and `Referer` headers only for third-party requests whose local decision is `restrict`.
- Scope: requests with a real tab id. Requests with `tabId < 0` are ignored.
- Classification: request URL is compared against the current page URL with public-suffix-aware site parsing.
- Aggregation: rows are keyed by normalized request hostname and relationship.
- Evidence: rows keep local-only counts, request categories, first/last seen timestamps, sanitized redirect host hops, frame/document/initiator hosts, path hints, and visibility notes. Full URLs, query strings, request bodies, and header values are not stored.
- Blocking: known third-party catalog entries with `defaultAction: "block"` are canceled unless the site is paused or the hostname is allowed by the user.
- Restricting: known third-party catalog entries or path rules with `defaultAction: "restrict"` are allowed to load with outgoing cookies and referrers removed where Firefox exposes headers.
- Unknown third parties: observed and shown, but allowed by default.

Relevant code:

- `src/entrypoints/background.ts`
- `src/shared/domains.ts`
- `src/shared/requestObservation.ts`
- `src/shared/ruleDecisions.ts`
- `src/shared/trackerCatalog.ts`

## Sources

### Top-Level Page Navigation

Source:
The user, page scripts, redirects, form submissions, links, or browser session restore can navigate the main frame to a new URL.

How to inspect:
Yes, mostly. The address bar and Network panel show main document navigations and redirects that DevTools captures. Session restore and extension/background-caused navigations may need browser history, extension logs, or `tabs` events to explain the cause.

How to intercept:
Use `webRequest.onBeforeRequest` for `main_frame` requests to reset per-tab state. Use `tabs.onUpdated` as a second navigation signal. Use redirect listeners later if redirect chains need to be recorded.

Current solution:
Implemented. `main_frame` clears the tab observation state and pause-once state when the site changes. It is not treated as a blockable third-party request.

### Same-Page Parser Subresources

Source:
HTML can load scripts, images, stylesheets, fonts, media, favicons, manifests, objects, embeds, and other parser-discovered assets.

How to inspect:
Yes, usually. The Inspector can show markup references, and the Network panel shows fetched assets by type. It may miss resources inserted and removed quickly, resources hidden behind CSS/import chains, cache-served items, or browser-internal favicon/manifest behavior unless Network logging is already open.

How to intercept:
Use `webRequest.onBeforeRequest` and inspect `details.type`. Type-specific handling can distinguish `script`, `image`, `stylesheet`, `font`, `media`, and other resource kinds.

Current solution:
Mostly implemented for browser-exposed URL requests. The observer maps scripts, images, stylesheets, fonts, media, iframes, XHR/fetch, beacons/pings, WebSockets, objects, manifests, and prefetch-like requests into local categories. Browser-specific or unrecognized types still fall into `other`.

### Script-Created Fetch And XHR

Source:
Page JavaScript, third-party scripts, workers, and SDKs can send `fetch()` and `XMLHttpRequest` calls to analytics, advertising, identity, A/B testing, personalization, or logging endpoints.

How to inspect:
Yes for the requests, not always for the cause. The Network panel can show Fetch/XHR entries, payload previews, timing, and initiator stacks when available. Minified third-party SDKs, workers, and dynamically generated calls can make the exact source hard to identify from page inspection alone.

How to intercept:
Use `webRequest.onBeforeRequest` for `xmlhttprequest`. Later improvements can add path-level rules for URLs containing precise endpoints such as `/collect`, `/track`, `/events`, `/beacon`, or `/conversion`.

Current solution:
Implemented at hostname level with path hints. `xmlhttprequest` is mapped to `xhr`, classified by site relationship, and blocked/restricted only when the hostname or precise local path rule matches a catalog entry or user override.

### Beacon And Ping Requests

Source:
Pages can use `navigator.sendBeacon()`, link pings, unload beacons, and analytics SDKs to send small event payloads, often during page exit or interaction tracking.

How to inspect:
Partly. The Network panel may show beacon and ping uploads, especially with persistent logs enabled before interacting or navigating away. Exit-time beacons can be easy to miss, and DevTools may not preserve enough context to explain what event triggered them.

How to intercept:
Use `webRequest.onBeforeRequest` for `beacon` and `ping` request types where exposed. Path-level rules are especially useful because beacon hosts are sometimes mixed-use.

Current solution:
Partially implemented. `beacon` and `ping` are both mapped to `beacon`, and rows include an exit-beacon visibility note. Blocking/restricting can use hostname catalog entries or precise path rules, but event payloads are not inspected.

### Third-Party Scripts

Source:
Sites can include third-party scripts directly, including ad tags, analytics SDKs, tag managers, social widgets, session replay tools, and fraud or payment helpers.

How to inspect:
Yes for loaded script files. The Inspector shows `<script>` tags that remain in the DOM, and the Network/Sources panels show fetched script URLs. Page inspection does not prove what the script does internally unless you inspect code behavior, and dynamically injected scripts may not be obvious after the fact.

How to intercept:
Use `webRequest.onBeforeRequest` for `script`. Pair hostname catalog rules with breakage-aware allow entries for functional services.

Current solution:
Implemented at hostname level. Known tracker script hosts block by catalog. Functional services can be cataloged as `allow`. There is no script-content inspection.

### Tag Managers

Source:
Tag managers load one script that can dynamically inject many analytics, advertising, and conversion tags after page load.

How to inspect:
Partly. DevTools can show the tag-manager loader and the downstream network requests it injects. It may not expose the container configuration, rules, consent state, or full "this tag manager caused this exact request" chain without initiator stacks or vendor-specific debugging.

How to intercept:
Block or restrict known tag-manager hostnames, or block the downstream requests they create. A more careful future approach is metadata plus path-level or vendor-specific rules, because blocking the loader can break legitimate site behavior.

Current solution:
Hostname and path-rule catalog behavior exists. There is no special tag-manager model and no reliable child-request attribution to the tag manager that caused a request beyond browser-exposed initiator/document/frame host evidence.

### Iframes And Embedded Documents

Source:
Pages can embed third-party documents for ads, video players, social widgets, comments, maps, login, payment, CAPTCHA, or customer support widgets.

How to inspect:
Yes, usually. The Inspector shows iframe elements, and the Network panel shows `sub_frame` document loads. Cross-origin iframe contents may be restricted in DevTools, and dynamically created or sandboxed frames can make the purpose harder to inspect.

How to intercept:
Use `webRequest.onBeforeRequest` for `sub_frame`. Use the frame's `documentUrl` or `originUrl` to classify subresource requests relative to the embedding page. Future work can preserve frame ancestry for better explanations.

Current solution:
Partially implemented. `sub_frame` maps to `iframe`. Rows store frame id, parent frame id where exposed, frame/document hosts, and a visibility note when frame ancestry is limited. The extension does not inspect cross-origin frame contents.

### Requests Inside Third-Party Frames

Source:
A third-party iframe can load its own scripts, pixels, XHR, images, and nested frames.

How to inspect:
Partly. The Network panel can show requests from frames, and Firefox DevTools can often filter or inspect per frame. Page inspection alone may not preserve a reliable frame ancestry chain, especially for nested frames, redirects, sandboxing, and requests that fire before DevTools is open.

How to intercept:
Use `webRequest` events and classify against the top-level tab site if the product goal is "third parties on this page." Preserve both top-level site and frame initiator if explanations need to say who loaded whom.

Current solution:
Partially implemented. Requests are aggregated by request hostname and classified against the top-level page where available. Rows now keep browser-exposed document, origin, initiator, frame id, and parent frame id hints, but this is still not a complete script-level causality chain.

### Redirect Chains

Source:
Ads, affiliate links, login flows, consent tools, and measurement endpoints can redirect through multiple third-party domains before reaching the final resource.

How to inspect:
Yes when captured, but fragile. The Network panel can show redirect chains for a request if logging was active and preserved. Cross-tab navigations, downloads, blocked requests, or very fast intermediate hops may need `webRequest.onBeforeRedirect` records for a complete account.

How to intercept:
Add `webRequest.onBeforeRedirect` and possibly `onCompleted`/`onErrorOccurred` to record redirect hops, final status, and whether a blocked request would have appeared only as an intermediate hop.

Current solution:
Implemented for visible network redirects. `onBeforeRedirect` records sanitized redirect hops by source host, destination host, status code, and timestamp on the local row. Full redirect URLs and query strings are not stored.

### WebSocket Connections

Source:
Pages, SDKs, dashboards, chat widgets, analytics tools, and real-time personalization services can open `ws:` or `wss:` connections.

How to inspect:
Yes for open WebSocket connections. The Network panel can show WebSocket handshakes and frames while DevTools is open. It will not classify privacy meaning by itself, and closed connections or worker-originated sockets can be harder to attribute after the fact.

How to intercept:
Use `webRequest.onBeforeRequest` for WebSocket URLs where exposed by the browser. Classify `ws:` and `wss:` with the same site logic as HTTP(S).

Current solution:
Partially implemented. Domain classification supports `ws:` and `wss:`, and WebSocket handshakes map to the `websocket` category when Firefox exposes them. WebSocket message frames are not inspected or classified.

### EventSource And Streaming Fetch

Source:
Pages can open server-sent events, streaming fetches, or long-polling requests for analytics, experimentation, notifications, chat, or personalization.

How to inspect:
Yes for visible connections, weakly for labels. The Network panel shows long-lived fetch/XHR/EventSource-style requests and their timing. It may not clearly distinguish streaming intent from ordinary XHR/fetch without response headers, body behavior, or code inspection.

How to intercept:
Use `webRequest.onBeforeRequest`. Browser request type may appear as `xmlhttprequest` or another generic type, so path and response metadata may be needed for better labeling.

Current solution:
Covered only as ordinary network requests. Long-lived fetch/EventSource-style traffic is usually `xhr` or another browser request type, with lifecycle timing captured but no separate streaming category.

### Workers And Worklets

Source:
Dedicated workers, shared workers, service workers, audio worklets, paint worklets, and imported worker scripts can initiate network requests or load additional scripts.

How to inspect:
Partly. DevTools can show worker scripts and worker-originated requests in some views, and the Debugger can inspect workers when attached. Worklets and worker initiators are not always obvious from the page DOM, so extension request metadata is more reliable for coverage.

How to intercept:
Use `webRequest` for worker script loads and worker-originated network requests when the browser exposes them to the extension. Record `details.type` and initiator metadata where available.

Current solution:
Partially covered if the request has a normal tab-associated `webRequest` event. Browser-exposed document/origin/initiator hosts are stored when available, but worker-specific attribution is still incomplete.

### Service Workers

Source:
A site's service worker can serve cached content, initiate background fetch-like behavior, or proxy page requests through its own fetch handler.

How to inspect:
Partly, but no for complete coverage. DevTools can show registered service workers, cache storage, and some network requests involving service workers. Responses served entirely from service-worker cache may not appear as normal network traffic, and background behavior may require service-worker debugging or extension-side diagnostics.

How to intercept:
Use `webRequest` for network requests that actually hit the network. Service-worker-served cache responses may not create normal network traffic. Future diagnostics may need to distinguish "not seen because cached" from "not requested."

Current solution:
No special service-worker handling. Only network requests visible to `webRequest` are observed.

### Preload, Prefetch, Prerender, DNS Prefetch, And Preconnect

Source:
HTML hints and HTTP headers can ask the browser to resolve DNS, open connections, preload assets, prefetch future pages, or prerender content.

How to inspect:
Partly. The Inspector can show `<link rel="preload">`, `<link rel="prefetch">`, `dns-prefetch`, and `preconnect` hints, and Network can show URL-bearing preload/prefetch fetches. DNS prefetch, preconnect, and prerender preparation are not always visible as normal request rows.

How to intercept:
Use `webRequest` for actual URL-bearing fetches such as preload or prefetch when exposed. DNS prefetch and connection setup may not have a normal blockable request URL. Future work can classify visible preloads separately because they may not mean the user interacted with the third party.

Current solution:
Partially covered for URL-bearing requests only. Prefetch/preload-like request types map to `prefetch` and receive a visibility note that DNS/preconnect work may not appear as requests.

### HTTP Headers That Cause More Requests

Source:
Headers such as `Link`, redirects, refresh behavior, reporting endpoints, and policy headers can cause the browser to request more URLs.

How to inspect:
Partly. The Network panel can show response headers and the resulting follow-on requests if they happen while logging is active. Page Inspector/DOM inspection alone will not reveal header-driven causes, and later requests may need header correlation to explain.

How to intercept:
Use `webRequest` for the resulting URL requests. Use `onHeadersReceived` later if the extension needs to inspect or modify response headers before follow-on requests happen.

Current solution:
Only resulting requests are observed. Response headers are not inspected or modified, except redirects are recorded through `onBeforeRedirect`.

### Reporting, CSP, NEL, And Error Reports

Source:
Browsers can send Content Security Policy reports, Network Error Logging reports, crash/error reports from SDKs, or Reporting API payloads to third-party endpoints configured by the page.

How to inspect:
Partly. Response headers and Network uploads may reveal CSP, NEL, Reporting API, or SDK report endpoints. Some reports fire only after errors, violations, or later navigations, so page inspection is not a reliable complete inventory.

How to intercept:
Use `webRequest` for visible report uploads. Add request type/path handling for report endpoints if they need special explanation.

Current solution:
Covered only as ordinary requests if visible. Report-like endpoints may surface through request types, path hints, and lifecycle state, but there is no reporting-specific category and report bodies are not inspected.

### Cookies, Referrers, And Request Headers

Source:
Third-party requests can carry cookies, referrers, user agent hints, authorization headers, ETags, and other identifiers. The tracking signal may be in the headers rather than the hostname alone.

How to inspect:
Yes for captured requests, but handle carefully. The Network panel shows request headers, cookies, referrers, and cache validators for visible requests. It does not show requests that never hit the network, and inspecting bodies or sensitive headers should not become product behavior by default.

How to intercept:
Use `webRequest.onBeforeSendHeaders` to inspect or modify outgoing headers where supported. Use cookie APIs or header modification for a future `restrict` mode.

Current solution:
Partially implemented through a deliberate `restrict` action. Restricted third-party requests are allowed to load, but outgoing `Cookie` and `Referer` headers are removed where Firefox exposes request headers. Other identifiers are not modified.

### Response Headers And Identifier Setting

Source:
Third parties can set cookies, cache identifiers, redirects, HSTS state, reporting endpoints, or other browser state through response headers.

How to inspect:
Yes for captured responses, partly for stored state. The Network panel shows response headers such as `Set-Cookie`, redirects, cache headers, and reporting headers. Storage/Cookies panels can show resulting state, but not every browser state surface is obvious or tied back to the responsible response.

How to intercept:
Use `webRequest.onHeadersReceived` where supported to inspect or modify response headers. Use this carefully because it can affect site correctness.

Current solution:
Not implemented. Response headers are not inspected or modified.

### Local Storage, IndexedDB, Cache API, And Other Web Storage

Source:
Third-party scripts and frames can write identifiers to web storage, IndexedDB, Cache API, service worker caches, or other browser storage exposed to their origin.

How to inspect:
Partly. The Storage panel can show localStorage, IndexedDB, Cache API entries, cookies, and service-worker storage by origin. It usually cannot tell which script wrote a value, and cross-origin frame storage may require selecting the right origin or debugging the frame directly.

How to intercept:
A WebExtension cannot generally intercept every page storage write with `webRequest`. Content scripts can observe or patch some page APIs, but doing so is fragile, invasive, and hard to do safely across isolated worlds. Blocking or restricting the network request that loads the third-party script/frame is usually cleaner.

Current solution:
Not implemented. TrackerBlocker stores only its own settings in `browser.storage.local` and does not inspect page storage.

### CNAME Cloaking And First-Party-Looking Trackers

Source:
A site can point a first-party-looking hostname, such as `metrics.example.com`, at a third-party tracker through DNS CNAME records. The URL still appears same-site.

How to inspect:
No, not from page inspection alone. DevTools shows the requested hostname, not necessarily the DNS CNAME chain behind it. Confirming this needs DNS lookup data, curated rules, browser-provided canonical name metadata, or separate diagnostics.

How to intercept:
Hostname/site classification alone is insufficient. Detection would require DNS/CNAME knowledge, curated first-party cloaking rules, or browser-provided canonical name data if available.

Current solution:
Not implemented. If the request URL is same-site by eTLD+1, it is treated as first-party and allowed.

### Mixed-Use Infrastructure

Source:
CDNs, cloud providers, CAPTCHA, payments, login, maps, video, and security vendors can be third-party and privacy-relevant, but often provide essential functionality.

How to inspect:
Partly. DevTools can show the third-party hosts, request paths, frames, scripts, and headers. It cannot decide safely whether a mixed-use provider is essential, tracking, or both without catalog context, endpoint knowledge, and breakage testing.

How to intercept:
Prefer allow or restrict behavior for broad infrastructure. Use narrow hostname/path rules only for confirmed tracking endpoints. Keep breakage risk metadata before changing defaults.

Current solution:
Partially implemented. The catalog can mark functional services as `allow`, tracking services as `block`, and reviewed mixed-use services as `restrict`. Path-level rules can block or restrict precise endpoints on otherwise allowed hosts.

### Browser And Extension Internal URLs

Source:
Pages and extensions can reference `about:`, `moz-extension:`, `data:`, `blob:`, `file:`, and other non-web schemes.

How to inspect:
Yes for references that exist in the page or Network/Sources views, but they are not normal third-party web requests. Blob and data URLs may only be inspectable while the creating page context exists, and extension URLs may expose only what the browser permits.

How to intercept:
Do not treat these as third-party web requests. Classify non-web schemes as ignored or unclassifiable, and avoid overclaiming.

Current solution:
Implemented in domain classification. Only `http:`, `https:`, `ws:`, and `wss:` are comparable web schemes.

### Background Or Browser-Managed Requests

Source:
The browser, other extensions, update checks, safe browsing, captive portal checks, and extension background contexts can create requests without a normal content tab.

How to inspect:
No, not from inspecting a page. These requests may appear in browser-level tooling or extension debugging contexts, but they are intentionally outside the page DevTools view and should not be mixed into page tracker summaries.

How to intercept:
Avoid mixing browser-owned traffic with page-owned tracking decisions. If future diagnostics need this, store it separately and label it clearly.

Current solution:
Intentionally ignored. Requests with `tabId < 0` are skipped.

### User-Initiated Downloads And External Protocols

Source:
Clicks can start downloads, open external apps, or invoke protocol handlers. Some ad and affiliate flows use download or protocol redirects.

How to inspect:
Partly. The Network panel may show URL requests and redirects before a download or external protocol handoff. Once the browser hands off to Downloads or another app, page inspection is no longer enough; download APIs or browser UI/history may be needed.

How to intercept:
Use `webRequest` for URL requests before the handoff when visible. Downloads may also need the downloads API if the product later wants download-specific diagnostics.

Current solution:
Only normal URL requests are observed. There is no downloads or protocol-specific handling.

### Form Posts And Navigation Submissions

Source:
Forms can submit data to first-party or third-party endpoints, including marketing, payment, login, and newsletter services.

How to inspect:
Yes for destination and headers when captured. The Inspector shows form `action` and `method` when present, and Network shows the submitted request. Dynamic form handlers, JS-generated payloads, and request bodies should be handled cautiously for privacy.

How to intercept:
Use `webRequest.onBeforeRequest` for navigation or subresource requests. Do not inspect request bodies by default; that would be privacy-sensitive and unnecessary for hostname blocking.

Current solution:
Covered as ordinary requests when visible. TrackerBlocker does not inspect request bodies.

### Extension UI And Settings Messages

Source:
The popup and options pages request tab summaries and update settings through extension messaging.

How to inspect:
No, not from the inspected web page. These are extension-internal messages visible through extension debugging/logging, not page DevTools. Keeping them separate protects the page request model from internal control traffic.

How to intercept:
Use `browser.runtime.onMessage` for extension-internal control messages. Keep this separate from page request observation.

Current solution:
Implemented. Popup/options messages read summaries and settings, update site pause, update hostname overrides, and reset local settings.

## Improvement Backlog

1. Done: `onBeforeRedirect` records sanitized redirect host hops.
2. Done: `onBeforeSendHeaders` supports a deliberate `restrict` mode for outgoing cookies and referrers.
3. Partially done: rows preserve browser-exposed initiator/document/frame ancestry, but not full script-level causality.
4. Done: request type mapping includes `font`, `media`, `websocket`, `object`, `manifest`, `prefetch`, and fallback `other`.
5. Done: catalog entries can define precise `path-prefix` and `url-prefix` rules.
6. Done: catalog entries support optional specific source/confidence provenance plus breakage risk and notes; generic review labels are not presented as evidence.
7. Done: expanded popup rows surface restricted, uncataloged, and weak-visibility local evidence without remote submission.
8. Ongoing: unobservable or weakly observable areas remain labeled: CNAME cloaking, service-worker cache hits, DNS prefetch, preconnect, browser-owned requests, response-header state, and page storage writes.
