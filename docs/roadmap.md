# Roadmap

This document tracks open product work and deferred decisions.

## Open Work

### UI confidence

- Add a small repeatable browser UI harness when it can exercise real extension
  popup/options behavior reliably.
- Cover empty, loading, degraded, permission-denied, narrow-width, keyboard,
  and recovery states.

### EasyPrivacy maintenance

- Refresh the retained source deliberately using the documented networked
  command.
- Review capability and size deltas before accepting an update.
- Rerun local Firefox, minimum-version, recovery, and manual representative-site
  checks in proportion to the update.

### Release preparation

- Choose the permanent Firefox extension ID and a real release version.
- Record a reproducible reviewer build environment and exact `npm ci`/build
  instructions.
- Prepare AMO metadata and distribution automation only when publication is
  scheduled; keep credentials outside the repository.

## Deferred Decisions

- Automatic EasyPrivacy `main_frame` enforcement requires its own explanation,
  recovery design, and breakage evaluation.
- Cosmetic filtering, scriptlets, CSP, response rewriting, and parameter
  rewriting remain out of scope.
- Telemetry, remote classification, runtime filter downloads, cloud sync, and
  network-dependent explanations remain prohibited without an explicit product
  and privacy decision.
