# TrackerBlocker

A Firefox-first extension that blocks and explains likely third-party trackers
using local rules and packaged data. It requires Firefox 142 or later.

## Development

Install the locked dependencies and run the extension:

```sh
npm ci
npm run dev:firefox
```

Common checks:

```sh
npm test
npm run typecheck
npm run lint:firefox
npm run zip:firefox
```

There is no `start`/`start:firefox` script. `npm run dev:firefox` builds and
launches Firefox with live reload. To instead load a static build produced by
`npm run build:firefox`, run `npm run web-ext:firefox`, which launches Firefox
against `.output/firefox-mv3` without watching for changes.

## Behavior

The popup reports immutable blocked, restricted, and allowed request attempts
for the active tab. It keeps host totals separate from request totals, explains
representative decisions using packaged local data, and exposes bounded-data
notices when a summary is incomplete.

“Allow on this site” is the primary recovery action. Users can also pause a
site once or always, or set advanced global hostname overrides. Durable settings
stay in `browser.storage.local`. Tab-scoped pause-once state and a minimal
per-document enforcement ledger use `browser.storage.session`; that ledger
contains only Firefox's opaque document identifier and blocked-request count.
Detailed request evidence stays only in bounded background memory.

## EasyPrivacy

Supported EasyPrivacy network blocks and exceptions are packaged locally and
enabled by default for subresources. Automatic EasyPrivacy `main_frame`
enforcement remains disabled. Build with `WXT_EASYPRIVACY_MATCHING=false` for an
emergency policy rollback.

The exact upstream source, checksums, capability exclusions, generator, and
[third-party notices](public/THIRD-PARTY-NOTICES.txt) are versioned with the
artifact. See the [EasyPrivacy maintenance guide](docs/easyprivacy.md) for
update, verification, package, and rollback instructions.

## Maintainer

Maintained by [Opt Out Rights Foundation](https://optoutrights.org).
