This repo should stay lightweight, privacy-preserving, and Firefox-first.

Tech stack:
- TypeScript
- WXT, using Vite through WXT rather than custom extension build glue
- WebExtensions with native `browser.*` APIs
- Preact for popup/options/onboarding UI
- Tailwind CSS for compact component styling
- `browser.storage.local` for durable user settings and site overrides
- `browser.storage.session` for tab-scoped pause-once state
- Packaged JSON for built-in tracker catalog and explanations
- Vitest for core logic tests
- Playwright for UI smoke tests when browser automation is added
- tldts for public-suffix-aware domain parsing
- web-ext for Firefox run, validation, and packaging workflows

Core rule: do not add telemetry, remote classification, or network-dependent tracker explanations without explicit user approval.
