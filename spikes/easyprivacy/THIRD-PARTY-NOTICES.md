# Phase 0 third-party notices

This directory is a compatibility spike, not a release artifact. It retains the
inputs and dependency versions needed to reproduce the measurements.

## EasyPrivacy

- Work: EasyPrivacy assembled filter list
- Authors: The EasyList authors
- Source: <https://easylist.to/easylist/easyprivacy.txt>
- Revision: recorded in `wxt/public/filter-data/easyprivacy.metadata.json`
- License: GPL version 3 or later, or CC BY-SA 3.0 or later, as described at
  <https://easylist.to/pages/licence.html>
- License selected for this GPLv3 repository: GPL version 3 or later

The downloaded source includes its upstream header and license link. The Phase 0
snapshot and generated engine are intentionally not committed. A production
release should keep the attribution, revision, checksum, and corresponding
source available with the generated artifact.

## Ghostery adblocker

- Package: `@ghostery/adblocker` 2.18.1 and its Ghostery subpackages
- Source: <https://github.com/ghostery/adblocker>
- License: Mozilla Public License 2.0

The installed packages include their MPL-2.0 license files. A production release
should add the dependency notices to its distributable notices/source bundle and
verify that the corresponding source remains available.

## Release gate

The selected EasyPrivacy license aligns with TrackerBlocker's GPLv3 license, and
the Ghostery dependency is offered under MPL-2.0. No engineering-level license
conflict was found for the spike. Before public distribution, the release owner
should verify the final notices and corresponding-source packaging rather than
relying on this technical review as legal advice.
