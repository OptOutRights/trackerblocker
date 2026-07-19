# EasyPrivacy supply chain

TrackerBlocker versions the exact EasyPrivacy source used to produce its
packaged network-rule engine. Normal installation, builds, tests, verification,
and extension runtime are offline with respect to EasyPrivacy. Only the
explicit maintainer update command contacts the upstream list.

The first integration is supported-only: ordinary network blocks and network
exceptions are packaged. Redirects, response or header modification, CSP,
parameter rewriting, cosmetic filtering, preprocessors, and unparsed syntax
are not converted into request cancellation. The generated capability report
keeps their counts and bounded samples reviewable. There is no runtime matcher
sidecar for unsupported actions.

## Versioned inputs and outputs

- `vendor/easyprivacy/easyprivacy.txt`: exact assembled upstream source.
- `vendor/easyprivacy/source.json`: acquisition URL, retrieval time, upstream
  version and commit, source size, and SHA-256.
- `public/filter-data/easyprivacy.engine`: serialized supported-only engine.
- `public/filter-data/easyprivacy.metadata.json`: generator, dependency,
  configuration, provenance, artifact checksum, and summary counts.
- `public/filter-data/easyprivacy.capabilities.json`: supported, excluded, and
  unparsed rule inventory with bounded samples.
- `public/THIRD-PARTY-NOTICES.txt`: attribution and license information shipped
  in both the extension and Firefox source archive.

## Runtime integration

The background loads the packaged engine and metadata from local
`moz-extension:` URLs, validates the metadata schema, enabled capabilities,
artifact size, and SHA-256, and then lets Ghostery validate and deserialize the
engine. Engine health is `loading`, `ready`, or `degraded`. Loading, degraded,
and disabled engine states use the existing local catalog policy; a partial or
invalid engine is never enforced.

WebExtension listeners register before asynchronous initialization begins.
Settings have a separate `loading`, `ready`, or `degraded` runtime state. A
cold request waits at most 500 ms for settings. After a successful read, later
timeouts or storage failures retain the last-known-good snapshot; without a
snapshot, the request is explicitly recorded as allowed because settings were
unavailable. No catalog or EasyPrivacy default is applied until settings are
known, so unknown pauses and Allow overrides cannot be bypassed. Successful
later reads recover the runtime without changing decisions already observed.

Phase 3 accounts for each observed request attempt rather than assigning one
decision to an entire hostname. Redirect attempts share the browser request ID
for correlation but receive increasing attempt indexes and immutable actions.
The badge counts blocked requests, while popup host counts are separately
labelled and can represent mixed blocked, restricted, and allowed activity.
All request evidence stays in bounded background memory; host-row, active
request, redirect, context, and matched-rule truncation is disclosed in the
popup. Only user settings remain in `browser.storage.local`.

EasyPrivacy matching remains disabled by default. For local Phase 3 testing,
opt in for one development session or build:

```sh
WXT_EASYPRIVACY_MATCHING=true npm run dev:firefox
WXT_EASYPRIVACY_MATCHING=true npm run build:firefox
```

The flag is build-time input, not a persisted extension setting. Do not commit
local `.env` flag files. The runtime does not load the capability report or the
retained source: unsupported actions remain generation-time review information
and cannot become runtime matches.

When opted in, supported EasyPrivacy blocks and exceptions apply to
subresources before the first-party default, including explicitly matched
first-party subresources. EasyPrivacy is not evaluated for automatic
`main_frame` cancellation in Phase 3. A global user Block override can still
cancel a matching top-level hostname; automatic top-level enforcement has a
separate Phase 5 coverage, breakage, and recovery gate.

## Refreshing EasyPrivacy

Install the exact locked dependencies first:

```sh
npm ci
```

Then run the only networked supply-chain command:

```sh
npm run update:easyprivacy
```

The command downloads only the canonical assembled EasyPrivacy URL, validates
its identity and bounds, inventories all unsupported behavior, compiles the
supported rules, and writes the complete source/artifact set only after those
steps succeed. Its JSON output compares source, artifact, supported-rule,
excluded-rule, and unsupported-modifier counts with the previous snapshot.
If upstream returns identical bytes, the original acquisition timestamp is
preserved and regeneration remains byte-identical.

Review all five versioned source and generated files together. In particular,
review:

- upstream version, commit, source SHA-256, and source-size change;
- block and exception count changes;
- every excluded and unsupported category delta and bounded sample;
- serialized artifact-size change;
- the pinned Ghostery version and engine configuration; and
- the EasyPrivacy and Ghostery attribution terms.

Do not approve an update whose unexplained capability or package-size change
cannot be accounted for. A rejected update can be recovered by restoring the
previous source manifest, source list, engine, metadata, and capability report
as one version-control change.

## Offline regeneration and verification

Regenerate from the committed source without network access:

```sh
npm run generate:easyprivacy
```

Verify provenance, rebuild the engine in memory, compare every generated byte,
deserialize it, and run representative matches:

```sh
npm run verify:easyprivacy
```

Repeated offline generation from the same committed source, acquisition
manifest, generator, and Ghostery version must be byte-identical. The artifact
contains no generation timestamp; the acquisition timestamp is recorded once
in `vendor/easyprivacy/source.json` and copied deterministically into metadata.

Before release, also run:

```sh
npm test
npm run typecheck
npm run lint:firefox
npm run zip:firefox
```

Confirm that the Firefox extension zip contains `filter-data/easyprivacy.engine`,
its metadata and capability report, and `THIRD-PARTY-NOTICES.txt`. Confirm that
the Firefox source zip additionally contains `vendor/easyprivacy/easyprivacy.txt`,
`vendor/easyprivacy/source.json`, the generator scripts, `package-lock.json`,
and the project license.
