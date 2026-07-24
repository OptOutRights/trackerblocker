# Tracker Blocker by Opt Out Rights

Tracker Blocker is a Firefox-first extension that blocks and explains likely
third-party trackers using local rules and packaged data. It requires Firefox
142 or later.

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

## AMO reviewer build

Tracker Blocker uses WXT, Vite, TypeScript, Preact, and Tailwind CSS, so every
AMO submission includes the matching source archive and this build procedure.
Mozilla's [default reviewer environment][amo-source] was last checked on
2026-07-24:

- Ubuntu 24.04.4 LTS on ARM64
- Node 24.14.0 and npm 11.9.0
- 6 vCPUs, 10 GB RAM, and at least 35 GB free disk

The release build is verified in an Ubuntu 24.04.4 ARM64 container with the
same Node, npm, and 6-vCPU configuration. The local Docker allocation used for
maintainer verification has 7.75 GiB RAM rather than the reviewer's 10 GB; no
build change or workaround is required, and the reviewer environment has more
memory available.

Starting in the root of the extracted source archive, verify the tool versions
and build the extension:

```sh
node --version
# v24.14.0
npm --version
# 11.9.0
npm ci --no-audit --no-fund
npm run build:firefox
```

The unpacked extension is written to `.output/firefox-mv3`. No generated file
refresh, environment variable, global npm package, private registry, local
dependency, or network service is required. `npm ci` downloads the exact
public-registry dependencies recorded in `package-lock.json`; all build tools
are open source and installed locally. In particular, leave
`WXT_EASYPRIVACY_MATCHING` unset so the packaged default remains enabled.

Maintainers create both submission archives in one build with:

```sh
npm run zip:firefox
```

This writes `trackerblocker-0.1.0-firefox.zip` and
`trackerblocker-0.1.0-sources.zip` to `.output`. The submitted extension is
verified by extracting the source ZIP into a fresh directory, running the
reviewer commands above, and comparing every file under
`.output/firefox-mv3` byte-for-byte with the extracted extension ZIP. ZIP
container bytes are not compared because ZIP timestamps can differ.

For maintainers, `npm run verify:amo:container` performs that complete process
from a fresh clone of a clean commit in the pinned ARM64 container and retains
the archives, file inventory, environment record, sizes, and SHA-256 hashes
under `.output/amo-evidence`. During development,
`npm run verify:amo:container -- --rehearsal` tests uncommitted changes but
marks its evidence as non-release.

[amo-source]: https://extensionworkshop.com/documentation/publish/source-code-submission/

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

Maintained by [Opt Out Rights](https://optoutrights.org).

## License

Copyright (C) 2026 Opt Out Rights.

Tracker Blocker is free software licensed under the
[GNU General Public License version 3 or later](LICENSE). Third-party code,
data, and fonts retain their upstream licenses and are documented in the
[third-party notices](public/THIRD-PARTY-NOTICES.txt).
