# Testing

This project should keep tests lightweight, local-first, and focused on privacy-sensitive behavior. Prefer fast unit tests for pure logic, then add browser/UI checks only where WebExtension runtime behavior matters.

## Test Structure

- `src/**/*.test.ts`: Vitest unit tests colocated with the code they cover.
- `src/shared/*.test.ts`: framework-independent core logic tests, such as domain classification.
- `src/messaging/*.test.ts`: message shape and type guard tests.
- Future UI smoke tests should live under a dedicated Playwright test area once popup/options behavior becomes user-visible enough to justify browser automation.

Current test files:

- `src/shared/domains.test.ts`: first-party vs third-party classification, URL normalization, WebSocket requests, public suffix cases, IPs, localhost, malformed inputs, and ignored schemes.
- `src/shared/requestObservation.test.ts`: passive request aggregation, request type mapping, row ordering, top-level page classification for frame requests, unknown/unclassifiable handling, resets, and empty summaries.
- `src/shared/trackerCatalog.test.ts`: packaged catalog validation, lookup matching, suffix boundaries, fallback explanation wording, and malformed catalog rejection.
- `src/shared/ruleDecisions.test.ts`: rule precedence, catalog defaults, unknown handling, first-party behavior, and pause/override decisions.
- `src/storage/settings.test.ts`: local settings defaults, normalization, migration, read/write helpers, updates, and reset behavior.
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
