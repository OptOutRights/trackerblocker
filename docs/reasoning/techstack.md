# Tech Stack

This project is a Firefox-first WebExtension that blocks likely third-party trackers and explains why each tracker is present. The stack should stay lightweight, local-first, and easy to audit.

## Chosen Stack

- **TypeScript**: Best fit for the extension's core domain model: tracker categories, request evidence, confidence levels, storage schemas, and enforcement decisions. It keeps privacy-sensitive logic explicit and testable.
- **WXT**: Best-in-class extension build tooling for this project. It uses Vite under the hood while handling extension-specific concerns like entrypoints, manifests, dev reload, and browser targets.
- **WebExtensions**: The correct platform API for Firefox extensions and the best path to future cross-browser support without designing around one vendor's runtime.
- **Preact**: Best UI runtime for this scope. It gives React-like component ergonomics for popup, options, and onboarding screens with a smaller footprint.
- **`browser.*` APIs**: Best native API style for Firefox. Promise-based APIs are clearer and align with Firefox's WebExtension implementation.
- **`browser.storage.local` and `browser.storage.session`**: Durable settings
  and site overrides stay on-device in local storage. Tab-scoped pause-once
  state uses session storage so it survives background-worker restarts without
  becoming browsing history. Request observations remain bounded in memory,
  and built-in tracker data ships with the extension.
- **Tailwind CSS**: Best styling option for a compact extension UI when used with restraint. It keeps styling local to components and avoids a large design-system dependency.
- **Vitest**: Best test runner for pure TypeScript logic such as first-party detection, tracker classification, explanation generation, and storage migrations.
- **Playwright**: Best option for future automated smoke tests and screenshots
  of critical popup/options flows.
- **tldts**: Best practical choice for eTLD+1/public-suffix-aware domain parsing. Third-party detection must not rely on naive string matching.
- **web-ext**: Best Firefox-oriented CLI for running, validating, packaging, and eventually signing the extension.

## Design Constraints

- Prefer static, packaged tracker intelligence over runtime network lookups.
- Keep all user data local by default; do not add telemetry or remote classification.
- Keep the core classification and explanation logic framework-independent so it can be tested without a browser.
- Treat Firefox as the primary target while keeping browser-specific enforcement behind adapters.
