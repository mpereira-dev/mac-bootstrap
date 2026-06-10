# Changelog

## [0.2.0] - 2026-06-10
### Added
- Profile system in packages.json: `core` / `node` / `ai` / `mobile` / `network`, each with a description and defaultEnabled flag. Every formula and cask now carries a `profile` field. Selection persists at ~/.mac-bootstrap/profiles.json.
- Interactive prompt during `./bin/bootstrap` lets you pick which profiles to enable; `--profiles=A,B`, `--yes`, and `--reconfigure` flags drive non-interactive flows.
- New packages in the manifest: `cocoapods` (mobile), `android-studio` (mobile), `flutter` (mobile), `tailscale-app` (network). All gated behind opt-in profiles.
- src/selections.js: persisted profile selection loader/saver/defaults.
- src/prompt.js: readline yes/no + pickProfiles UI.
- manifest.filterByProfiles(manifest, profiles) helper.

### Changed
- `./bin/bootstrap` now respects profile selection. Mobile + network are off by default.
- `./bin/doctor` only checks packages from enabled profiles.
- `./bin/nightly` only self-updates casks from enabled profiles.
- Default behavior on a fresh laptop: prompt once, save, never re-prompt unless `--reconfigure`.

### Notes
- Apple Silicon macOS only (was implicit; now stated).
- Companion repo: https://github.com/mpereira-dev/mac-scripts handles shell PATH/env wiring (this repo handles installation).
