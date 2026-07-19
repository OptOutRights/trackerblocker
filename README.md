# TrackerBlocker

A Firefox extension that learns which companies are tracking you across the web, blocks them before they load, and sends privacy signals telling companies not to sell, share, or track your data.

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

The popup shows hosts observed on the active tab, immutable blocked/restricted/allowed request counts, mixed-host activity, local catalog context, and expandable evidence. The badge counts blocked requests; the popup labels blocked-host counts separately. Users can pause protection once for the current tab/site, always pause the current site, or set a third-party hostname to Auto, Block, or Allow. The options page lists always-paused sites and hostname overrides, and can reset local settings. Settings stay in `browser.storage.local`; bounded request summaries, active decision correlation, and pause-once state stay in background memory.

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
