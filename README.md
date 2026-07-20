# TrackerBlocker

A Firefox-first extension that blocks and explains likely third-party trackers
using local rules and packaged data.

Requires Firefox 142 or later.

## Development

Install dependencies:

```sh
npm install
```

Run the extension in Firefox during development:

```sh
npm run dev:firefox
```

Build the Firefox extension:

```sh
npm run build:firefox
```

Check TypeScript:

```sh
npm run typecheck
```

Run tests:

```sh
npm test
```

Lint the built Firefox extension:

```sh
npm run lint:firefox
```

Package the Firefox extension:

```sh
npm run zip:firefox
```

## MVP Behavior

The popup shows hosts observed on the active tab, immutable blocked/restricted/allowed request counts, mixed-host activity, local catalog context, and bounded representative request explanations. The badge counts blocked requests; the popup labels blocked-host counts separately. “Allow on this site” is the primary recovery action, while global Auto/Block/Allow rules remain under an advanced control. The options page lists site-specific allows, always-paused sites, and global hostname overrides. Durable settings stay in `browser.storage.local`; pause-once state uses `browser.storage.session`; request observations and browsing evidence stay only in bounded background memory.

## EasyPrivacy Data

The repository includes a reproducible, supported-network-rule EasyPrivacy
artifact. The production background validates and loads the packaged artifact,
but EasyPrivacy matching and enforcement remain disabled by default behind an
explicit local build flag. The exact upstream source, checksum, capability
exclusions, generator, and open-source
[`notices`](public/THIRD-PARTY-NOTICES.txt) are versioned alongside it. See
[`docs/easyprivacy-updates.md`](docs/easyprivacy-updates.md) for the explicit
networked update command and offline verification workflow.

## Maintainer

Maintained by [Opt Out Rights Foundation](https://optoutrights.org).
