# MVP QA

This checklist records the current MVP verification state for local dogfooding.

## Automated Verification

Last run on July 20, 2026:

- `npm run verify:easyprivacy`: passed source provenance, byte-identical rebuild,
  deserialization, rule-count, dependency-version, and representative-match checks.
- `npm test`: passed, 21 test files and 175 tests. Phase 3/4/5 coverage includes
  synchronous startup ordering, the 500 ms settings gate, cold fail-open and
  last-known-good recovery, immutable mixed-host accounting, redirect-attempt
  correlation, bounded evidence and visible truncation flags, main-frame policy,
  blocked-request badge semantics, packaged-engine validation, block and
  exception evidence, header-restriction decision reuse, settings version 1 to
  2 migration, serialized mutations, site-scoped precedence, bounded session
  startup, authoritative top-level tab URL caching across worker restarts, IPv6
  settings keys, privacy-safe path hints, representative-sample retention, and
  stale detail-response rejection.
- `npm run typecheck`: passed.
- `npm run lint:firefox`: passed with 0 errors, 0 notices, and 1 bundled-code warning for dynamic `innerHTML`.
- `npm run zip:firefox`: passed and produced a 1,196,636-byte Firefox
  zip and an approximately 1.56 MB source zip. The Firefox zip includes the EasyPrivacy
  engine, metadata, capability report, and third-party notices; the source zip
  also includes the exact upstream source and generator.
- The reproducible same-commit catalog-only counterfactual is 258,563 bytes;
  the complete compressed EasyPrivacy adapter, dependency, and data delta is
  945,278 bytes, below the 1.5 MB gate.
- The default build embeds EasyPrivacy matching as enabled for supported
  subresources. The explicit `WXT_EASYPRIVACY_MATCHING=false` emergency-off
  build preserves catalog policy and also passes the Firefox matrix.
- Source inspection found only two runtime `fetch(...)` calls, both for the
  packaged `moz-extension:` engine and metadata. Manifest permissions are
  unchanged. Durable settings use `browser.storage.local`; pause-once state
  uses `browser.storage.session`; request evidence is not persisted. Firefox
  142 is the declared minimum required by the extension's storage and manifest
  usage.
- A bounded `web-ext run` smoke installed the default `.output/firefox-mv3`
  build as a temporary add-on in Firefox 152.0.6 with automatic reload disabled.
- The popup was rendered against a local mixed-host fixture at 380 px and 300
  px. Both widths had no horizontal overflow. Block and exception explanations,
  the primary “Allow on this site” control, and refresh feedback were exercised.
- The production-artifact corpus, current stable and Firefox 142 local matrices,
  five worker restarts, full-browser restarts, degraded and missing-permission
  variants, 14-site paired study, current Firefox performance, package/source
  inspection, and offline/privacy checks are recorded in the
  [Phase 5 evidence report](easyprivacy-phase-5-evidence-2026-07-20.md).

`rg "innerHTML|dangerouslySetInnerHTML" src` found no source-level usage related to the lint warning.

## Manual Browser Checklist

Use a fresh Firefox profile with `npm run dev:firefox` or the built `.output/firefox-mv3` extension.

- Visit a quiet first-party page such as `https://example.com` and confirm the popup handles an empty or near-empty request list.
- Visit a content site with third-party resources and confirm the popup shows hosts, per-action request counts, rule-source counts, and expanded local evidence.
- Confirm a known catalog-blocked hostname is canceled, the badge increments by one blocked request attempt, and the popup reports blocked requests separately from blocked hosts.
- Exercise a mixed-use hostname and confirm blocked and allowed attempts remain separate instead of labelling the entire hostname blocked.
- Expand that hostname and confirm representative attempts identify their
  action, causal source, normalized EasyPrivacy rule or exception, request
  type, scrubbed path hint, and optional local catalog explanation.
- Use “Allow on this site,” refresh, and confirm only that exact site/hostname
  pair is allowed. Confirm another site using the same hostname is unaffected.
- Pause protection once for the current site, refresh, and confirm third parties are listed but allowed because the site is paused.
- Navigate the same tab to another site, return to the original site, and confirm the pause-once state no longer applies.
- Always pause the current site, open it in another tab, and confirm the site remains paused until resumed.
- Set a blocked third-party hostname to Allow, refresh, and confirm it is allowed.
- Set an unknown third-party hostname to Block, refresh, and confirm it is blocked.
- In the default build, confirm a supported
  subresource block is canceled, a supported exception is allowed, and an
  explicitly matched first-party subresource follows the EasyPrivacy result.
- In the same build, confirm an EasyPrivacy-only `main_frame` match is
  not canceled, then confirm an explicit user Block override can cancel that
  top-level hostname.
- If a stress fixture exceeds a memory bound, confirm the popup exposes the
  relevant host, active-request, redirect, context, or matched-rule truncation
  notice and does not present bounded host counts as complete.
- Open the options page, confirm site-specific allows, always-paused sites, and
  global hostname overrides appear, then remove each item.
- Use the options reset control and confirm all three durable setting groups are cleared.

## Known Limitations

- A committed Playwright UI harness is not configured yet; current UI
  verification uses the in-app browser against a local runtime fixture plus the
  WXT build, `web-ext` validation, bounded Firefox launch, and checklist above.
- The packaged catalog is intentionally conservative and endpoint-focused; broad mixed-use product domains remain out of the default block list.
- Top-level navigations reset per-tab evidence and are not request rows, so redirect evidence covers tracked subresources rather than main-frame redirect chains.
- EasyPrivacy is default-on for supported subresources. Named maintainer
  licensing/attribution sign-off remains required before public release or
  distribution. Automatic `main_frame` enforcement remains a separately gated
  future project.
