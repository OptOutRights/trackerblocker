# EasyPrivacy

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
- `vendor/easyprivacy/easyprivacy.capabilities.json`: supported, excluded, and
  unparsed rule inventory with bounded samples for supply-chain review.
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

The runtime accounts for each observed request attempt rather than assigning one
decision to an entire hostname. Redirect attempts share the browser request ID
for correlation but receive increasing attempt indexes and immutable actions.
The badge and popup protection total read the same per-document enforcement
ledger and count only request paths that return a cancellation to Firefox.
The ledger stores only Firefox's opaque document identifier and blocked-request
count in `browser.storage.session`. The count survives an MV3 worker restart
only when Firefox exposes the current native identifier for verification; older
versions report it as unavailable after restart. The entry is removed when
protection continuity is lost instead of claiming zero. Popup host counts are
separately labelled and can represent mixed blocked, restricted, and allowed activity. All detailed
request evidence stays in bounded background memory; host-row, active request,
redirect, context, matched-rule, and representative-attempt truncation is
disclosed in the popup. Durable user settings remain in
`browser.storage.local`. Tab-scoped pause-once state also uses
`browser.storage.session` so a Firefox MV3 worker restart does not silently
resume protection; it is cleared when the tab closes or navigates away.

Supported EasyPrivacy subresource matching is enabled by default. For an
emergency policy rollback, use the explicit off value for one development
session or build:

```sh
WXT_EASYPRIVACY_MATCHING=false npm run dev:firefox
WXT_EASYPRIVACY_MATCHING=false npm run build:firefox
```

The flag is build-time input, not a persisted extension setting. Do not commit
local `.env` flag files. The runtime does not load the capability report or the
retained source: unsupported actions remain generation-time review information
and cannot become runtime matches.

Supported EasyPrivacy blocks and exceptions apply to subresources before the
first-party default, including explicitly matched
first-party subresources. EasyPrivacy is not evaluated for automatic
`main_frame` cancellation. A global user Block override can still
cancel a matching top-level hostname. Automatic top-level enforcement is not
enabled and would require a separate explanation, recovery, and breakage
evaluation.

Distribution checks are objective: the exact source, checksums, notices,
required license texts, generated artifact, and reproducible source archive
must be present and internally consistent. A missing or ambiguous obligation is
a concrete issue to resolve, not a named-approval gate.

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

The EasyPrivacy command runs the deterministic local/current-Firefox checks in
order:

```sh
npm run test:easyprivacy
```

### Package and release evidence

Run the focused package evidence check with:

```sh
npm run test:easyprivacy:package
```

This command performs real Firefox builds and creates the extension and source
archives. It verifies that:

- archive names use the version from `package.json`;
- generated and packaged manifests contain the approved version and release
  identity;
- no unexpected update URL is present;
- required EasyPrivacy data, provenance, notices, and reviewer source files are
  included;
- generation-only and private build files are excluded; and
- the EasyPrivacy package-size delta remains within its reviewed bounds.

The report prints the Git revision, working-tree state, package version,
extension ID, archive names, sizes, and SHA-256 hashes. The hashes identify the
exact archives produced by that run; do not assume a later rebuild will have
the same ZIP hash without a separate reproducibility comparison.

Development runs may report working-tree changes. Final release evidence must
be produced from the clean committed release revision.

Run the Firefox 142 matrix separately using the commands in `docs/testing.md`.
Before a public release, also sample representative content, commerce, login,
and quiet first-party sites using the checklist in `docs/qa.md`.

For an emergency policy rollback, build explicitly with matching disabled and
run its Firefox proof:

```sh
WXT_EASYPRIVACY_MATCHING=false npm run build:firefox
npm run test:easyprivacy:firefox:off
```

Confirm that the Firefox extension zip contains `filter-data/easyprivacy.engine`,
its metadata, and `THIRD-PARTY-NOTICES.txt`, but not the generation-time
capability report. Confirm that the Firefox source zip additionally contains
`vendor/easyprivacy/easyprivacy.txt`,
`vendor/easyprivacy/easyprivacy.capabilities.json`,
`vendor/easyprivacy/source.json`, the generator scripts, `package-lock.json`,
and the project license.
