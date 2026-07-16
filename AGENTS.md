# Repository guidance

TrackerBlocker is a public, open-source, Firefox-first extension. Keep it lightweight, privacy-preserving, and understandable to outside contributors.

## Public project hygiene

- Write commits, comments, and documentation for a public audience. Do not include secrets, personal data, private links, machine-specific paths, or context available only to maintainers.
- Keep changes and commit messages focused and self-explanatory. Record rationale that a contributor could verify from public repository context.
- Update the closest existing document when behavior, setup, permissions, privacy, or public interfaces change. Do not add documentation merely to narrate implementation work.

## Product and implementation constraints

- Do not add telemetry, remote classification, or network-dependent tracker explanations without explicit approval.
- Keep user settings, site overrides, and learned data in `browser.storage.local`; keep built-in tracker data and explanations packaged with the extension.
- Prefer native `browser.*` WebExtension APIs and Firefox behavior. Avoid Chrome-only assumptions and custom build glue outside WXT/Vite.
- Use the established TypeScript, Preact, Tailwind CSS, Vitest, `tldts`, and `web-ext` patterns already in the repository. Check `package.json` rather than duplicating dependency details here.
- Use public-suffix-aware domain parsing; do not infer site boundaries with naive hostname splitting.

## Verification

- Add or update focused Vitest coverage for logic changes and regressions.
- Run `npm test` and `npm run typecheck` for code changes.
- Also run `npm run build:firefox` when extension entrypoints or bundling are affected, and `npm run lint:firefox` when permissions, manifests, packaging, or Firefox runtime behavior changes.
- Report checks actually run and any relevant verification that remains manual.
