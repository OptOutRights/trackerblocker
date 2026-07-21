# MVP Scope

The MVP is a Firefox-first tracker blocker inspired by Privacy Badger, with one important product distinction: it explains what third parties are likely doing on the page. The first version should be useful, local-first, and shippable without runtime AI calls.

## Core Feature: Blocking Third Parties

The extension should observe page requests, identify third-party domains, aggregate them by request hostname for the current tab, and block known tracker hostnames according to local rules.

Blocking behavior:
- Detect first-party vs third-party requests using public-suffix-aware domain parsing.
- Maintain a live list of third-party hostnames and request counts for the active tab.
- Block known tracking categories by default, such as advertising, cross-site analytics, session replay, and social tracking.
- Allow likely functional categories by default, such as payments, security/fraud prevention, and essential CDN-style infrastructure.
- Allow unknown third parties by default in the MVP, but show them clearly as unknown.
- Record blocked requests so the popup shows attempted requests, not only successful loads.
- Respect user overrides before automatic rules.
- Respect full-site pause before per-hostname blocking.

The UI should avoid overclaiming. The popup should say "third parties" rather than "trackers"; known catalog entries can be labeled as likely advertising, analytics, session replay, social, payment, CDN, or unknown.

## Popup

The popup is the primary user surface.

Default view:
- Show the current site and whether protection is active.
- Show a compact summary: total third parties, blocked count, allowed count, and unknown count.
- Show an aggregate list of all third-party hostnames seen on the current tab.
- Each row should show the hostname, request count, likely category when known, and a basic status on the right, such as blocked or allowed.
- Each row can expand to show more information.

Expanded row details:
- Entity/company if known.
- One-sentence explanation of what the third party is likely used for.
- Request types seen, such as script, image, iframe, XHR, beacon, stylesheet, or other.
- Current rule source: automatic, blocked by user, allowed by user, or allowed because site is paused.
- Per-hostname control: Auto, Block, Allow.

Unknown third parties should fail gracefully with plain language, for example: "This third party was seen loading resources, but it is not in the local tracker catalog yet."

## Controls

The MVP should support two override levels:

- **Narrow recovery**: Allow a hostname only on the current site.
- **Advanced per-hostname control**: Globally set Auto, Block, or Allow for a specific third-party hostname.
- **Per-site pause**: Pause protection once for the current tab/site or always for the current site until turned back on.

“Allow on this site” is the primary broken-request recovery path. Per-site pause remains the broader fallback. Pause once survives refresh and background-worker restarts while the tab remains on that site, but clears when the tab navigates to another site or closes. Always pause is saved locally and applies to that site in any tab. When a site is paused, third-party hostnames should still be listed, but their status should clearly say they are allowed because protection is paused.

## Options Page

The options page should stay small in the MVP:

- List always-paused sites with a way to remove each pause.
- List site-specific hostname allows with a way to remove each allow.
- List global per-hostname overrides with a way to reset each override to Auto.
- Provide a reset option for local settings.
- State that settings and local controls stay on the device.

## Local Tracker Catalog

The MVP should ship with a static, packaged catalog of common third-party domains.

Each catalog entry should include:
- Domain or suffix match.
- Entity/company when known.
- Category.
- Default action: block or allow.
- One-sentence explanation.

There should be no runtime model calls and no remote classification in the MVP. Explanations should come from local rules and packaged data.

## Out Of Scope For MVP

- Remote AI classification.
- Telemetry or accounts.
- Cloud sync.
- Large browsing history dashboards.
- Fingerprinting detection.
- CNAME cloaking detection.
- Complex learning algorithms.
- Full URL display by default.

## Build Status

Agents should update this section as MVP pieces are started and completed. Keep notes short and link to implementation docs or issues when useful.

- [x] Project scaffold: WXT, TypeScript, Preact, Tailwind, and Firefox dev workflow.
- [x] Request observation: collect third-party requests for the active tab.
- [x] Domain classification: first-party vs third-party detection with public-suffix-aware parsing.
- [x] Local tracker catalog: packaged entries with category, default action, entity, and explanation.
- [x] Blocking engine: apply automatic rules, site-scoped allows, global per-hostname overrides, pause once, and always pause.
- [x] Popup default view: site status, summary counts, and aggregate third-party hostname list.
- [x] Popup expanded rows: representative request explanations, primary site-scoped recovery, and advanced global controls.
- [x] Options page: site-specific allows, always-paused sites, global hostname overrides, reset controls, and local-only privacy note.
- [x] Local storage: versioned settings migration, serialized mutations, site/global overrides, always-paused sites, and session-only pause-once state.
- [x] Tests: core classification, rule decisions, explanation lookup, and storage behavior.
- [x] EasyPrivacy Phase 5 engineering evidence: production corpus, real Firefox
  142/current behavior, recovery and worker lifecycle, paired-site breakage,
  performance/package, and offline/privacy inspection.
- [x] EasyPrivacy default enablement: supported subresource matching defaults
  on, with automatic `main_frame` enforcement off and an explicit emergency-off
  build value. Named licensing/attribution sign-off remains a pre-release TODO
  before public distribution. See the
  [dated Phase 5 evidence](easyprivacy-phase-5-evidence-2026-07-20.md).
