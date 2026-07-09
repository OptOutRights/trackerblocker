# TrackerBlocker

A Firefox-first WebExtension that blocks likely third-party trackers and explains why each third party is present.

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

## Maintainer

Maintained by [Opt Out Rights Foundation](https://optoutrights.org).
