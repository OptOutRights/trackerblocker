# MVP QA

This checklist records the current MVP verification state for local dogfooding.

## Automated Verification

Last run on July 18, 2026:

- `npm run verify:easyprivacy`: passed source provenance, byte-identical rebuild,
  deserialization, rule-count, dependency-version, and representative-match checks.
- `npm test`: passed, 17 test files and 136 tests. Phase 3 coverage includes
  synchronous startup ordering, the 500 ms settings gate, cold fail-open and
  last-known-good recovery, immutable mixed-host accounting, redirect-attempt
  correlation, bounded evidence and visible truncation flags, main-frame policy,
  blocked-request badge semantics, packaged-engine validation, block and
  exception evidence, and header-restriction decision reuse.
- `npm run typecheck`: passed.
- `npm run lint:firefox`: passed with 0 errors, 0 notices, and 1 bundled-code warning for dynamic `innerHTML`.
- `npm run zip:firefox`: passed and produced an approximately 1.19 MB Firefox
  zip and 1.51 MB source zip. The Firefox zip includes the EasyPrivacy
  engine, metadata, capability report, and third-party notices; the source zip
  also includes the exact upstream source and generator.
- The Firefox zip is approximately 940 KB larger than the 247,134-byte Phase 0
  TrackerBlocker baseline, below the 1.5 MB compressed-cost gate.
- The default build embeds EasyPrivacy matching as disabled. An explicit
  `WXT_EASYPRIVACY_MATCHING=true` Firefox build also completed for Phase 3
  subresource enforcement, followed by fresh default-off lint and zip builds.
- Source inspection found only two runtime `fetch(...)` calls, both for the
  packaged `moz-extension:` engine and metadata. The manifest permissions and
  settings-only `browser.storage.local` schema are unchanged.
- A bounded Phase 2 `web-ext run` smoke installed the default `.output/firefox-mv3`
  build as a temporary add-on in headless Firefox with automatic reload
  disabled; the process was terminated after successful installation. This
  browser smoke was not repeated for Phase 3.

`rg "innerHTML|dangerouslySetInnerHTML" src` found no source-level usage related to the lint warning.

## Manual Browser Checklist

Use a fresh Firefox profile with `npm run dev:firefox` or the built `.output/firefox-mv3` extension.

- Visit a quiet first-party page such as `https://example.com` and confirm the popup handles an empty or near-empty request list.
- Visit a content site with third-party resources and confirm the popup shows hosts, per-action request counts, rule-source counts, and expanded local evidence.
- Confirm a known catalog-blocked hostname is canceled, the badge increments by one blocked request attempt, and the popup reports blocked requests separately from blocked hosts.
- Exercise a mixed-use hostname and confirm blocked and allowed attempts remain separate instead of labelling the entire hostname blocked.
- Pause protection once for the current site, refresh, and confirm third parties are listed but allowed because the site is paused.
- Navigate the same tab to another site, return to the original site, and confirm the pause-once state no longer applies.
- Always pause the current site, open it in another tab, and confirm the site remains paused until resumed.
- Set a blocked third-party hostname to Allow, refresh, and confirm it is allowed.
- Set an unknown third-party hostname to Block, refresh, and confirm it is blocked.
- In an opt-in `WXT_EASYPRIVACY_MATCHING=true` build, confirm a supported
  subresource block is canceled, a supported exception is allowed, and an
  explicitly matched first-party subresource follows the EasyPrivacy result.
- In the same opt-in build, confirm an EasyPrivacy-only `main_frame` match is
  not canceled, then confirm an explicit user Block override can cancel that
  top-level hostname.
- If a stress fixture exceeds a memory bound, confirm the popup exposes the
  relevant host, active-request, redirect, context, or matched-rule truncation
  notice and does not present bounded host counts as complete.
- Open the options page, confirm always-paused sites and hostname overrides appear, then remove each item.
- Use the options reset control and confirm always-paused sites and hostname overrides are cleared.

## Known Limitations

- Playwright UI smoke tests are not configured yet; runtime UI verification currently relies on WXT build, `web-ext` validation, bounded Firefox launch, and the manual checklist above.
- The packaged catalog is intentionally conservative and endpoint-focused; broad mixed-use product domains remain out of the default block list.
- Top-level navigations reset per-tab evidence and are not request rows, so redirect evidence covers tracked subresources rather than main-frame redirect chains.
- Request-listener startup, storage-failure recovery, and real cancellation
  timing still need a fresh-profile Firefox smoke for Phase 3; unit tests and
  Firefox build/lint/package checks do not fully simulate worker wakeups.
