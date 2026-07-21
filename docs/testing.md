# Testing

This project should keep tests lightweight, local-first, and focused on privacy-sensitive behavior. Prefer fast unit tests for pure logic, then add browser/UI checks only where WebExtension runtime behavior matters.

## Test Structure

- `src/**/*.test.ts`: Vitest unit tests colocated with the code they cover.
- `src/shared/*.test.ts`: framework-independent core logic tests, such as domain classification.
- `src/messaging/*.test.ts`: message shape and type guard tests.
- Future UI smoke tests should live under a dedicated Playwright test area when
  the critical popup/options workflows justify browser automation.

Current test files:

- `scripts/easyprivacy/supply-chain.test.mjs`: retained-source provenance,
  source identity checks, unsupported-rule inventory, and byte-identical
  regeneration of the packaged EasyPrivacy outputs.
- `scripts/easyprivacy/coverage.test.ts`: versioned Phase 5 production-artifact
  comparator, constraint controls, redirects, mixed hosts, precedence,
  fallback, unsupported actions, aggregates, and privacy-safe evidence.
- `src/shared/domains.test.ts`: first-party vs third-party classification, URL normalization, WebSocket requests, public suffix cases, IPs, localhost, malformed inputs, and ignored schemes.
- `src/shared/requestObservation.test.ts`: immutable request-attempt aggregation,
  mixed action/source counts, redirect correlation, bounded matched-rule,
  redirect, host-row, active-request and context evidence, bounded privacy-safe
  representative explanations, stale-generation rejection, lifecycle cleanup,
  lower-bound summaries, classification, resets, and empty summaries.
- `src/shared/backgroundStartup.test.ts`: listener registration completes before
  settings, filter-engine, and badge initialization begins without browser mocks.
- `src/shared/tabPageUrls.test.ts`: cold top-level tab URL resolution, caching,
  navigation races, late prior-document detection, and tab-removal races across
  background-worker restarts.
- `src/shared/trackerCatalog.test.ts`: packaged catalog validation, lookup matching, suffix boundaries, fallback explanation wording, and malformed catalog rejection.
- `src/shared/buildFlags.test.ts`: default-on EasyPrivacy and explicit
  emergency-off build-flag semantics, including invalid-value handling.
- `src/shared/filterEngine.test.ts`: packaged artifact validation, health,
  blocks, exceptions, request mapping, degraded fallback, and the production
  Ghostery import boundary.
- `src/shared/requestDecisions.test.ts`: normalized request contracts, unified
  precedence, disabled-policy catalog compatibility, EasyPrivacy exceptions and
  first-party subresources, explicit settings-unavailable fail-open decisions,
  header restrictions, and user-only main-frame blocking.
- `src/storage/settings.test.ts`: version 2 settings defaults, exact-hostname normalization, version 1 migration, serialized mutations, site-scoped allows, read/write helpers, updates, and reset behavior.
- `src/storage/sessionState.test.ts`: pause-once normalization and round trips through session-only storage.
- `src/storage/settingsRuntime.test.ts`: 500 ms cold-start timeout, late-read
  recovery, last-known-good retention, retry throttling, and stale-read races.
- `src/messaging/health.test.ts`: background health-check message guard behavior.
- `src/messaging/requestSummary.test.ts`: request summary message and response guard behavior.
- `src/messaging/settings.test.ts`: settings message and response guard behavior.

## Types Of Tests

### Unit Tests

Use Vitest for pure TypeScript logic. These tests should not require Firefox, extension permissions, network access, or persisted browser storage.

Good candidates:

- Domain and URL classification.
- Passive request evidence normalization and aggregation.
- Catalog lookup and explanation fallback.
- Rule decision precedence.
- Storage schema normalization and migrations.
- Message type guards and request/response shapes.

Run all unit tests:

```sh
npm test
```

Run one test file:

```sh
npx vitest run src/shared/domains.test.ts
```

Verify the committed EasyPrivacy engine from its retained source without
contacting the network:

```sh
npm run verify:easyprivacy
```

### Type Checking

Use TypeScript to catch API contract issues across shared modules, background code, and UI code.

```sh
npm run typecheck
```

### Extension Build Checks

Use WXT to confirm the extension bundles for Firefox MV3.

```sh
npm run build:firefox
```

This is useful after changing shared modules imported by entrypoints, manifest-affecting code, or dependencies.

### Firefox Extension Validation

Use `web-ext` linting against the built Firefox output.

```sh
npm run lint:firefox
```

This command builds first, then validates `.output/firefox-mv3`.

### Manual Firefox Runtime Checks

Use this when behavior depends on real browser APIs or extension pages.

```sh
npm run dev:firefox
```

For a packaged output with `web-ext`:

```sh
npm run build:firefox
npm run web-ext:firefox
```

Manual checks should be recorded in the relevant roadmap implementation notes when they cover behavior that Vitest cannot prove.

EasyPrivacy matching is enabled when the build flag is absent. Use the ordinary
development command for adapter, policy, and enforcement smoke tests:

```sh
npm run dev:firefox
```

Use `WXT_EASYPRIVACY_MATCHING=false` only for the explicit emergency-off build
and its dedicated Firefox proof.

Automatic EasyPrivacy `main_frame` enforcement is disabled in the default
build. Test top-level navigation cancellation with an explicit user
Block override only; automatic main-frame enforcement is a separately reviewed
future project.

### EasyPrivacy Phase 5 gates

Run the non-interactive local/current-Firefox gate:

```sh
npm run test:easyprivacy:phase5
```

The individual Firefox, performance, package, offline, and corpus commands are
available as `test:easyprivacy:*` package scripts. The public 14-site pair is a
dated, networked check and stays explicit:

```sh
npm run test:easyprivacy:sites
```

`npm run test:easyprivacy:firefox:off` builds with the explicit emergency-off
value and verifies catalog fallback plus main-frame non-enforcement in Firefox.

Run the local matrix against the Firefox 142 binary separately:

```sh
FIREFOX_BINARY=/path/to/firefox-142/firefox npm run test:easyprivacy:firefox
FIREFOX_BINARY=/path/to/firefox-142/firefox npm run test:easyprivacy:firefox:degraded
FIREFOX_BINARY=/path/to/firefox-142/firefox npm run test:easyprivacy:firefox:permission
FIREFOX_BINARY=/path/to/firefox-142/firefox npm run test:easyprivacy:firefox:off
```

Results and the development default-enablement decision are recorded in the
[Phase 5 evidence report](easyprivacy-phase-5-evidence-2026-07-20.md).

### Future UI Smoke Tests

Once popup/options pages contain real workflows, add Playwright smoke tests for critical UI behavior.

Good candidates:

- Popup renders current site status.
- Observed third-party rows aggregate correctly.
- Expanded row details show category, explanation, request types, and rule source.
- Pause/allow/block controls update visible state.

Keep Playwright tests small and focused. Pure logic should stay in Vitest.

## Recommended Verification Flow

For pure logic changes:

```sh
npm test
npm run typecheck
```

For changes imported by extension entrypoints:

```sh
npm test
npm run typecheck
npm run build:firefox
```

For manifest, permissions, packaging, or Firefox runtime changes:

```sh
npm test
npm run typecheck
npm run lint:firefox
```

## Testing Principles

- Keep tracker classification and decision logic browser-independent whenever possible.
- Treat malformed, missing, and unsupported inputs as first-class test cases.
- Test public-suffix-aware domain behavior instead of relying on naive hostname examples.
- Do not add tests that require runtime network calls or remote classification.
- Prefer local fixture data for tracker catalog and explanation tests.
- Add regression tests for bugs before changing the behavior they cover.
