# EasyPrivacy Phase 5 evidence — 2026-07-20

## Decision

**Go for development default enablement; no-go for public release or
distribution pending named licensing/attribution sign-off.**

The engineering, Firefox, recovery, breakage, performance, package, offline,
privacy, and source-archive evidence below passes the Phase 5 thresholds. The
ordinary build enables supported EasyPrivacy subresource matching by default.
The completed engineering licensing/source-archive review is sufficient for the
current development stage. A named maintainer must still record the
licensing/attribution review before any public release or distribution. This
report is not legal advice and does not substitute for that pre-release
sign-off.

Automatic EasyPrivacy `main_frame` enforcement is also a deliberate no-go for
this release. Supported subresource blocks and exceptions, including explicit
first-party subresource rules, are the only proposed default scope. Explicit
user Block overrides may continue to cancel a top-level hostname.

## Candidate identity and environment

- Repository baseline commit: `4c53af968800c64e4b358f15dbad92e5ca55d0c4`.
  The exact release-candidate commit is the commit containing this report; its
  hash is recorded by the final gate output and handoff because a commit cannot
  contain its own content-derived identifier.
- EasyPrivacy revision: `202607171801`, upstream commit
  `14423bbe5de88bca811ae5cb4ee63d8d1cf955c4`.
- Artifact SHA-256:
  `2c72268af8588d05e4c981f9e9262f9039f72c68a3e691cbf5a5eb802d19d163`.
- Development baseline: macOS, Apple Silicon, Node 26.4.0, clean `npm ci`
  dependency tree with Vite 8.1.3.
- Firefox floor: 142.0 from Mozilla's signed release archive, archive SHA-256
  `cc0ce6b3ec64d064c16187f92ca4a8df5a21a1d7aa2f79a9e82b44602f2b1a0f`.
- Current stable exercised: Firefox 152.0.6.

## Production-artifact corpus

`npm run test:easyprivacy:coverage` drives 47 identical normalized requests
through catalog-only and EasyPrivacy-enabled production policy.

| Measure | Catalog only | EasyPrivacy enabled |
| --- | ---: | ---: |
| Blocked requests | 3 | 24 |
| Blocked hosts | 3 | 19 |
| Allowed requests | 44 | 23 |
| Supported exceptions | — | 6 |
| Catalog fallbacks | — | 2 |
| Explicit first-party matches | — | 6 |
| Mixed hosts | — | 2 |
| Unsupported/non-enforceable samples | — | 5 |
| Functional-negative regressions | — | 0 |

The versioned corpus contains eight ordinary blocks, six exceptions, six
request-type positive/negative pairs, six source-site positive/negative pairs
(including a framed source), four first-party path positive/negative pairs,
five precedence cases, two engine fallback states, two redirect sequences, two
mixed-host sequences, five unsupported-action samples, and privacy-sensitive
summary inputs. A list refresh fails visibly if an expectation changes.

## Local Firefox and recovery

The local fixture uses real Firefox, the built MV3 extension, a loopback-only
server, and synthetic public test data. The same ready-engine matrix passed on
Firefox 142 and 152.0.6. It verifies:

- image, XHR, and WebSocket blocks with wrong-type controls;
- exceptions, top-level and framed source constraints, and first-party paths;
- redirect-attempt correlation, exact mixed-host accounting, scrubbed evidence,
  and automatic main-frame non-enforcement;
- exact-site recovery isolation, pause once/always, global Allow/Block,
  options removal, reset, and stale-popup rejection;
- pause once across five forced MV3 worker terminations, tab closure,
  cross-site navigation, and full Firefox restarts;
- durable override and pause-always restart behavior;
- local/session storage schemas with no request URL or browsing ledger; and
- local-only fixture traffic.

The primary network probe asserts exactly 10 request attempts: 5 blocked and 5
allowed across 6 hosts, with 3 blocked hosts and 2 genuinely mixed hosts. Its
WebSocket positive is recorded as an EasyPrivacy cancellation with no network
failure; the loopback negative control completes. The redirect source records
one exact 302 hop to the separately reclassified blocked destination. Four
representative attempts for the mixed host are asserted individually, including
their direct, redirect, privacy-scrubbed, and wrong-type paths. The exact probe
also passed 20 consecutive fresh-profile repetitions on current Firefox after
the direct and redirect fixture destinations were made unambiguous.

The corrupt-artifact run passed catalog fallback and header restriction on both
Firefox 142 and current stable. A separate manifest variant proved on both
versions that missing host permission is visible in extension health.
Storage-failure fail-open/last-known-good behavior remains covered by
deterministic runtime tests.

An explicit `WXT_EASYPRIVACY_MATCHING=false` build also passed on both Firefox
versions: catalog block/restriction remained active, EasyPrivacy-only traffic
was allowed, engine health stayed visible, and automatic main-frame enforcement
remained off. This proves the emergency runtime-policy rollback before changing
the ordinary default.

Commands:

```sh
npm run test:easyprivacy:firefox
npm run test:easyprivacy:firefox:degraded
npm run test:easyprivacy:firefox:permission
FIREFOX_BINARY=/path/to/firefox-142/firefox npm run test:easyprivacy:firefox
FIREFOX_BINARY=/path/to/firefox-142/firefox npm run test:easyprivacy:firefox:degraded
FIREFOX_BINARY=/path/to/firefox-142/firefox npm run test:easyprivacy:firefox:permission
FIREFOX_BINARY=/path/to/firefox-142/firefox npm run test:easyprivacy:firefox:off
```

## Paired 14-site breakage study

Fresh Firefox profiles ran identical public, non-credentialed tasks with
catalog-only and EasyPrivacy-enabled builds on July 20, 2026. Counts are
aggregate request/host counts; no request URLs, tokens, or form contents were
retained.

| Site/task | Category | Catalog blocked req/hosts | EasyPrivacy blocked req/hosts | Outcome |
| --- | --- | ---: | ---: | --- |
| Reuters public world page | News/content | 3 / 2 | 5 / 4 | Pass / pass |
| BBC public news page | News/content | 3 / 3 | 12 / 11 | Pass / pass |
| eBay public landing page | Commerce | 0 / 0 | 6 / 5 | Pass / pass |
| IKEA public landing page | Commerce | 3 / 2 | 39 / 19 | Pass / pass |
| GitHub sign-in entry | Login/account | 0 / 0 | 2 / 2 | Pass / pass |
| GitLab sign-in entry | Login/account | 0 / 0 | 0 / 0 | Site task unavailable in both modes |
| YouTube public landing page | Video/media | 1 / 1 | 2 / 2 | Site task unavailable in both modes |
| Vimeo public watch page | Video/media | 0 / 0 | 7 / 3 | Pass / pass |
| Stripe Checkout docs | Payment/demo | 0 / 0 | 4 / 3 | Pass / pass |
| PayPal Checkout demo | Payment/demo | 0 / 0 | 3 / 1 | Catalog task drift / EasyPrivacy pass |
| Reddit public landing page | Social/public | 2 / 1 | 8 / 4 | Pass / pass |
| Bluesky public landing page | Social/public | 0 / 0 | 1 / 1 | Pass / pass |
| Example Domain | Quiet first-party | 0 / 0 | 0 / 0 | Pass / pass |
| W3C Cool URIs | Quiet first-party | 0 / 0 | 0 / 0 | Pass / pass |

Incremental blocks appeared in all six network-active categories. There were
no quiet-site first-party cancellations and no reproducible EasyPrivacy-only
task regression. An earlier run produced one EasyPrivacy-side PayPal
expected-text mismatch and the immediately repeated fresh-profile pair passed;
the exact-candidate rerun instead produced the mismatch only in catalog mode
while EasyPrivacy passed. This is recorded as transient site drift, not waived
as a confirmed extension regression. Any future reproducible login/payment
failure remains a release blocker.

Run with `npm run test:easyprivacy:sites`. This command intentionally uses the
public network and prints a dated result; it is not part of the offline suite.

## Performance and package

`npm run test:easyprivacy:performance` measures the production adapter and
artifact inside Firefox 152.0.6:

- 20 packaged load, SHA-256 validation, and deserialization runs: 51.00 ms p95
  (threshold: less than 100 ms);
- 50,000 representative normalized request + synchronous match operations:
  0.0100 ms p95 (threshold: less than 1 ms); and
- representative block, exception, no-match, type, source, first-party, and
  WebSocket contexts included. Raw samples are printed by the command.

`npm run test:easyprivacy:package` inspected the built package and source zip:

- same-commit catalog-only counterfactual: 258,334 bytes;
- same-commit EasyPrivacy package: 1,203,610 bytes;
- complete compressed EasyPrivacy adapter, dependency, and data delta: 945,276
  bytes (threshold: less than
  1.5 MB);
- Firefox zip: 1,196,408 bytes;
- source zip: approximately 1.56 MB (its exact compressed size changes when
  this included evidence report changes); and
- unchanged permissions, no content scripts, and all required source/artifact
  entries present.
  Private/local build inputs such as `GOAL.md`, `.env`, `.git`, `.output`,
  `.wxt`, and `node_modules` are asserted absent.

## Offline, privacy, and licensing inspection

- Normal generation and verification use committed inputs. Only
  `npm run update:easyprivacy` downloads the list.
- Runtime source contains two `fetch` calls, both to packaged
  `moz-extension:` engine/metadata URLs.
- The full local Firefox capture observed only loopback fixture traffic.
- `browser.storage.local` contained only versioned settings;
  `browser.storage.session` contained only bounded tab-scoped pause state.
- Request evidence remained bounded background memory and was scrubbed from
  summary path/query evidence.
- Package/source inspection found the exact retained list, acquisition
  manifest, engine, metadata, capability report, generator, verifier, lockfile,
  notices, and project GPL text.
- Notices now identify `@ghostery/adblocker` packages at tag `v2.18.1`,
  `@ghostery/url-parser` at tag `v1.3.1`, their copyright notices, the full
  MPL-2.0 text location, and the selected GPLv3 text/location for EasyPrivacy.
  Both upstream tags were confirmed through their Git repositories.
- **Pre-release TODO:** before any public release or distribution, a named
  maintainer must record acceptance of this distribution review or obtain
  qualified review for any remaining ambiguity. This is not a blocker to the
  current local development default.

## Release-candidate gate

- [x] Versioned comparator and functional negatives pass.
- [x] Exceptions and unsupported actions match the documented scope.
- [x] Firefox 142 and current stable local matrices pass.
- [x] Real redirects, frames, type/source constraints, first-party paths, and
      mixed hosts pass.
- [x] Recovery, reset, stale context, and five worker restarts pass.
- [x] Paired 14-site study has no reproducible critical/high regression.
- [x] Current Firefox performance and compressed-size budgets pass.
- [x] Permission/package/source/offline/storage boundaries pass engineering
      inspection.
- [x] Engineering licensing and source-archive inspection is sufficient for
      development default enablement.
- [ ] Before public release/distribution, named maintainer
      licensing/attribution sign-off is recorded.
- [x] Automatic EasyPrivacy `main_frame` enforcement remains disabled.
- [x] The explicit emergency-off build and runtime-policy rollback are tested.
- [x] The independent ordinary-default flip is implemented.
- [x] The exact committed release candidate is rerun through the complete gate.

The unchecked named-sign-off item blocks public release or distribution, not
local development default enablement. Rollback is the explicit emergency-off
build flag for runtime policy, or one atomic revert of the retained source,
acquisition manifest, engine, metadata, and capability report for a list
regression. No telemetry, runtime list download, remote classification, or
network explanation is involved.

## Verification entry points

```sh
npm run test:easyprivacy:phase5
npm run test:easyprivacy:sites
npm run verify:easyprivacy
npm test
npm run typecheck
npm run lint:firefox
npm run zip:firefox
```

`test:easyprivacy:phase5` is the non-interactive local/current-Firefox gate.
The public-site command and Firefox 142 command remain explicit so they cannot
be silently skipped or mistaken for offline checks.
