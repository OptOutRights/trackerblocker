# MVP QA

This checklist records the current MVP verification state for local dogfooding.

## Automated Verification

Last run on July 7, 2026:

- `npm test`: passed, 8 test files and 72 tests.
- `npm run typecheck`: passed.
- `npm run lint:firefox`: passed with 0 errors, 0 notices, and 1 bundled-code warning for dynamic `innerHTML`.
- `npm run zip:firefox`: passed and produced `.output/trackerblocker-0.0.0-firefox.zip` and `.output/trackerblocker-0.0.0-sources.zip`.
- Bounded runtime smoke: `web-ext run` installed `.output/firefox-mv3` as a temporary add-on in headless Firefox before the smoke command was terminated.

`rg "innerHTML|dangerouslySetInnerHTML" src` found no source-level usage related to the lint warning.

## Manual Browser Checklist

Use a fresh Firefox profile with `npm run dev:firefox` or the built `.output/firefox-mv3` extension.

- Visit a quiet first-party page such as `https://example.com` and confirm the popup handles an empty or near-empty request list.
- Visit a content site with third-party resources and confirm the popup shows third-party hostnames, categories, counts, statuses, and expanded explanations.
- Confirm a known catalog-blocked hostname is canceled and still appears as blocked in the popup.
- Pause protection once for the current site, refresh, and confirm third parties are listed but allowed because the site is paused.
- Navigate the same tab to another site, return to the original site, and confirm the pause-once state no longer applies.
- Always pause the current site, open it in another tab, and confirm the site remains paused until resumed.
- Set a blocked third-party hostname to Allow, refresh, and confirm it is allowed.
- Set an unknown third-party hostname to Block, refresh, and confirm it is blocked.
- Open the options page, confirm always-paused sites and hostname overrides appear, then remove each item.
- Use the options reset control and confirm always-paused sites and hostname overrides are cleared.

## Known Limitations

- Playwright UI smoke tests are not configured yet; runtime UI verification currently relies on WXT build, `web-ext` validation, bounded Firefox launch, and the manual checklist above.
- The initial catalog is intentionally small and representative.
