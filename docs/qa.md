# Firefox QA

Use this checklist for user-visible or Firefox-runtime changes. Run against a
fresh profile using `npm run dev:firefox` or the built
`.output/firefox-mv3` extension.

## Automated Checks

```sh
npm run verify:easyprivacy
npm test
npm run typecheck
npm run lint:firefox
npm run zip:firefox
```

Run `npm run test:easyprivacy` when filter policy, request observation,
recovery, storage, permissions, performance, packaging, or Firefox lifecycle
behavior changes.

## Browser Checklist

- Confirm a quiet first-party page produces a useful empty or near-empty state.
- On a content page, confirm request totals, host totals, rule-source counts,
  statuses, and local explanations agree.
- Confirm the badge counts blocked request attempts, not blocked hosts.
- Confirm a mixed-use hostname retains separate blocked and allowed attempts.
- Expand representative attempts and inspect action, source, request type,
  scrubbed path hint, and EasyPrivacy rule or exception evidence.
- Use “Allow on this site,” refresh, and confirm the allow affects only that
  exact site and hostname.
- Confirm pause once survives refresh and worker restart, then clears on
  cross-site navigation and tab closure.
- Confirm pause always applies in another tab and remains removable.
- Confirm global Allow and Block overrides retain their documented precedence.
- Confirm a supported EasyPrivacy block is canceled, an exception is allowed,
  and an explicitly matched first-party subresource follows the filter result.
- Confirm an automatic EasyPrivacy `main_frame` match is not canceled, while an
  explicit user Block override can cancel a top-level hostname.
- Confirm settings removal and reset work from the options page.
- At narrow popup widths, confirm controls remain usable without horizontal
  overflow and focus indicators remain visible.
- When a stress fixture exceeds a memory bound, confirm the popup discloses the
  relevant truncation rather than presenting bounded totals as complete.
- Before release, sample public content, commerce, login, and quiet first-party
  sites in a fresh profile. Compare any suspected regression with EasyPrivacy
  disabled, avoid credentials or transactions, and record only the task outcome
  and aggregate counts needed to diagnose it.

## Known Limitations

- There is no committed Playwright UI harness. UI verification uses Vitest,
  WXT builds, `web-ext` validation, real-Firefox fixtures, and manual checks.
- The packaged catalog is intentionally conservative; broad mixed-use product
  domains remain out of its default block rules.
- Top-level navigations reset tab evidence and are not shown as request rows.
- Automatic EasyPrivacy `main_frame` enforcement is a separate future project.
