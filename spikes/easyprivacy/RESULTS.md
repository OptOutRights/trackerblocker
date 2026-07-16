# EasyPrivacy compatibility and cost spike

Date: July 16, 2026

Decision: **Go to Phase 1, with the conditions below.**

The core `@ghostery/adblocker` package can compile and synchronously match a
packaged EasyPrivacy network-rule artifact within the proposal's initial size
and performance budgets. The spike does not change TrackerBlocker's production
background behavior, permissions, settings, or UI.

## Inputs and environment

- TrackerBlocker baseline: `8772a27`
- Ghostery package: `@ghostery/adblocker` 2.18.1, pinned in `package-lock.json`
- EasyPrivacy version: `202607162010`
- EasyPrivacy commit: `39b3d59cef8fc3a4f82016494ff198860afeed42`
- EasyPrivacy source SHA-256:
  `438e92d56bde53de57b4ce534da5325be5521a447ad659cc53fc20ed113f421b`
- Development baseline: Apple M5, 16 GB RAM, macOS 26.4, Node.js 26.4.0 arm64

The assembled list snapshot and generated engine are intentionally ignored to
avoid permanently vendoring temporary megabyte-scale artifacts. Their exact
revision, checksums, counts, and measurements are retained here and in the
committed metadata. `npm run spike:easyprivacy:update` is the explicit networked
step that downloads the current assembled list and generates local artifacts;
subsequent `npm run spike:easyprivacy:generate` runs are offline.

## Compatibility result

The synthetic fixture and compatibility tests cover:

- ordinary third-party block rules;
- EasyPrivacy exceptions;
- source-domain constraints;
- request-type constraints;
- explicit first-party path rules;
- serialization/deserialization parity; and
- exclusion of redirects, CSP, parameter removal, and response modification.

The pinned EasyPrivacy source produced:

| Rule category | Count | Packaged for cancellation |
| --- | ---: | --- |
| Ordinary block rules | 54,664 | Yes |
| Exceptions | 828 | Yes |
| Redirect rules | 22 | No |
| CSP rules | 2 | No |
| Response-modification rules | 1 | No |
| Unparsed rules | 3 | No |
| Cosmetic rules | 35 | No |

The generated engine contains 55,492 of 55,517 parsed network rules
(99.9550%). The three unparsed rules are two rewrite/redirect variants and one
HTTP-method-constrained rule. Their exact bounded samples are recorded in
`capabilities.json` and the generated metadata.

Unsupported actions are never converted into request cancellation. The
supported-only compiler removes them before serialization, and the capability
report makes each excluded category reviewable.

## Size measurements

The paired WXT harnesses differ only in the Ghostery import, packaged artifact,
and load/match smoke code.

| Measurement | Bytes |
| --- | ---: |
| Empty WXT harness Firefox zip | 790 |
| EasyPrivacy spike Firefox zip | 940,422 |
| Compressed added cost | 939,632 |
| Initial target | 1,500,000 |
| Serialized engine, uncompressed | 1,655,753 |
| Current TrackerBlocker Firefox zip, for context | 247,134 |

Result: **pass**. The measured compressed delta is 560,368 bytes below the
initial 1.5 MB budget.

## Performance measurements

Cold initialization used 20 fresh Node.js processes. Match latency used 50,000
iterations across six representative blocked and allowed HTTP/WebSocket
fixtures. The end-to-end measurement creates a new Ghostery `Request` with a
varying URL before every match.

| Measurement | Median | p95 | Maximum | Target |
| --- | ---: | ---: | ---: | ---: |
| Artifact read | 0.744 ms | 0.815 ms | 0.857 ms | — |
| Engine deserialization | 4.871 ms | 5.752 ms | 5.873 ms | <100 ms |
| Fresh process to ready | 42.464 ms | 47.404 ms | 53.068 ms | <100 ms |
| Engine match only | 0.001 ms | 0.002 ms | 0.143 ms | <1 ms p95 |
| Request creation + match | 0.002 ms | 0.007 ms | 0.304 ms | <1 ms p95 |

Result: **pass** on the development baseline. These are Node.js measurements;
the Firefox build was separately installed in headless Firefox as a bounded
runtime smoke test. Phase 3 should repeat initialization timing inside Firefox
when the real background initialization state exists.

## Firefox and privacy checks

- WXT produced a Firefox MV3 build containing the engine as a packaged asset.
- `web-ext lint` reports zero errors, warnings, or notices for both harnesses.
- The candidate manifest has no permissions or host permissions.
- The built background has one executed `fetch(...)`, targeting its own
  `moz-extension:` artifact URL.
- The bundle contains dormant URLs and convenience methods from the Ghostery
  class implementation, but the spike does not invoke them and the manifest
  grants no remote host access.
- The engine configuration disables cosmetics, CSP, HTML filtering, extended
  selectors, mutation observers, and navigation-time injection.

## License review

`THIRD-PARTY-NOTICES.md` records EasyPrivacy's GPLv3+/CC BY-SA licensing and
Ghostery's MPL-2.0 licensing. The spike selects EasyPrivacy's GPLv3-or-later
option to align with this GPLv3 repository. No engineering-level conflict was
found, but production notices and corresponding-source packaging remain a
release gate.

## Conditions for Phase 1

1. Preserve the supported-only compilation step and fail generation if an
   excluded category cannot be inventoried.
2. Treat changes in excluded or unparsed rules as reviewable update deltas.
3. Keep normal generation, builds, tests, and runtime offline; only an explicit
   update command may fetch EasyPrivacy.
4. Add production third-party notices and source packaging before release.
5. Decide before Phase 2 whether runtime diagnostics need a secondary matcher
   for unsupported actions. The current artifact reports them globally at
   generation time but intentionally treats them as no-match at runtime.

The recommendation for condition 5 is to keep the first integration
supported-only and expose the capability report in diagnostics. Add a runtime
unsupported-rule sidecar only if user-facing evidence shows that per-request
unsupported explanations justify its size and complexity.

## Reproduction

```sh
npm ci
npm run spike:easyprivacy:test
npm run spike:easyprivacy:update
npm run spike:easyprivacy:verify-generated
npm run spike:easyprivacy:benchmark
npm run spike:easyprivacy:zip-baseline
npm run spike:easyprivacy:zip
npm run spike:easyprivacy:measure-size
npx web-ext lint --source-dir spikes/easyprivacy/wxt-baseline/.output/firefox-mv3
npx web-ext lint --source-dir spikes/easyprivacy/wxt/.output/firefox-mv3
```

The detailed machine-readable outputs are `capabilities.json`,
`benchmark-results.json`, `package-results.json`, and
`wxt/public/filter-data/easyprivacy.metadata.json`.

The committed measurements describe the revision and checksums above. Because
the canonical assembled-list URL advances over time, a later networked update
evaluates the then-current revision; it does not recreate the historical bytes.
