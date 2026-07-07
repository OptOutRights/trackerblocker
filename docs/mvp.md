# MVP Scope

The MVP is a Firefox-first tracker blocker inspired by Privacy Badger, with one important product distinction: it explains what third parties are likely doing on the page. The first version should be useful, local-first, and shippable without runtime AI calls.

## Core Feature: Blocking Third Parties

The extension should observe page requests, identify third-party domains, aggregate them by domain for the current tab, and block known tracker domains according to local rules.

Blocking behavior:
- Detect first-party vs third-party requests using public-suffix-aware domain parsing.
- Maintain a live list of third-party domains and request counts for the active tab.
- Block known tracking categories by default, such as advertising, cross-site analytics, session replay, and social tracking.
- Allow likely functional categories by default, such as payments, security/fraud prevention, and essential CDN-style infrastructure.
- Allow unknown third parties by default in the MVP, but show them clearly as unknown.
- Record blocked requests so the popup shows attempted requests, not only successful loads.
- Respect user overrides before automatic rules.
- Respect full-site pause before per-domain blocking.

The UI should avoid overclaiming. The popup should say "third parties" rather than "trackers"; known catalog entries can be labeled as likely advertising, analytics, session replay, social, payment, CDN, or unknown.

## Popup

The popup is the primary user surface.

Default view:
- Show the current site and whether protection is active.
- Show a compact summary: total third parties, blocked count, allowed count, and unknown count.
- Show an aggregate list of all third-party domains seen on the current tab.
- Each row should show the domain, request count, likely category when known, and a basic status on the right, such as blocked or allowed.
- Each row can expand to show more information.

Expanded row details:
- Entity/company if known.
- One-sentence explanation of what the third party is likely used for.
- Request types seen, such as script, image, iframe, XHR, beacon, stylesheet, or other.
- Current rule source: automatic, blocked by user, allowed by user, or allowed because site is paused.
- Per-domain control: Auto, Block, Allow.

Unknown third parties should fail gracefully with plain language, for example: "This third party was seen loading resources, but it is not in the local tracker catalog yet."

## Controls

The MVP should support two override levels:

- **Per-domain control**: Auto, Block, or Allow for a specific third-party domain.
- **Per-site pause**: Pause protection for the current site until turned back on.

Per-site pause is the broken-site recovery path. When a site is paused, third-party domains should still be listed, but their status should clearly say they are allowed because protection is paused.

## Options Page

The options page should stay small in the MVP:

- List paused sites with a way to remove each pause.
- List per-domain overrides with a way to reset each override to Auto.
- Provide a reset option for local settings.
- State that settings and learned data stay on the device.

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
- [ ] Local tracker catalog: packaged entries with category, default action, entity, and explanation.
- [ ] Blocking engine: apply automatic rules, per-domain overrides, and per-site pause.
- [ ] Popup default view: site status, summary counts, and aggregate third-party domain list.
- [ ] Popup expanded rows: explanation, request types, rule source, and Auto/Block/Allow control.
- [ ] Options page: paused sites, domain overrides, reset controls, and local-only privacy note.
- [ ] Local storage: settings schema, migrations, overrides, and paused sites.
- [ ] Tests: core classification, rule decisions, explanation lookup, and storage behavior.
