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

The popup shows third-party hostnames observed on the active tab, local catalog categories, blocking status, and expandable explanations. Users can pause protection once for the current tab/site, always pause the current site, or set a third-party hostname to Auto, Block, or Allow. The options page lists always-paused sites and hostname overrides, and can reset local settings. Settings stay in `browser.storage.local`; observed request summaries and pause-once state are kept in background memory.

## EasyPrivacy Data

The repository includes a reproducible, supported-network-rule EasyPrivacy
artifact for the next filtering phase. It is packaged in normal Firefox builds
but is not yet loaded or enforced by the production background. The exact
upstream source, checksum, capability exclusions, generator, and open-source
[`notices`](public/THIRD-PARTY-NOTICES.txt) are versioned alongside it. See
[`docs/easyprivacy-updates.md`](docs/easyprivacy-updates.md) for the explicit
networked update command and offline verification workflow.

## Maintainer

Maintained by [Opt Out Rights Foundation](https://optoutrights.org).
