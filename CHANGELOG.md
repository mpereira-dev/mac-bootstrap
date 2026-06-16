# Changelog

## [Unreleased]
### Changed
- `ai` profile is now **off by default**. A plain `./bin/bootstrap --yes` installs only `core` + `node`.
- `ai`, `mobile`, and `network` are **hidden** from the interactive picker unless `--all-profiles` is passed. They remain installable directly via `--profiles=...`, and a hidden profile that is already enabled stays visible on `--reconfigure` so it is never silently dropped.
- `cloud` profile gained `aws-cdk` (Homebrew formula, command `cdk`), alongside `awscli`.
- CLI help is now a nested, topic-based system across all four commands (`--help`, `--help <topic>`, `--help <topic> <subtopic>`). `./bin/bootstrap --help profiles` renders a pretty profile table (default/picker state + packages). `migrate --help detection|verdicts|removal` documents how installs are found and removed.

### Added
- `bin/migrate` (+ `src/migrate.js`) — the act-on-it half of the migrate-then-bootstrap flow. Consumes `tools/provenance.sh --json`, and for every tool flagged `MIGRATE` it installs the mac-bootstrap-managed version (brew/Volta) then removes the old copy. Plan-only by default; `--apply` executes, `--yes` skips the per-removal confirm. The managed install runs first and is idempotent; the old copy is removed only after it lands. Removals needing human judgement (`.pkg` receipts, `<placeholder>` versions, manual drops) are printed, never auto-run.
- `tools/provenance.sh --json` — machine-readable output mode consumed by `bin/migrate`. Human report unchanged without the flag.
- Corepack: `./bin/bootstrap` now runs `corepack enable` when the `node` profile is on, and `./bin/doctor` checks it. This is the managed way to get per-project `pnpm`/`yarn` versions — each project pins its own via the `package.json` `"packageManager"` field, so no global pnpm install is needed (and a standalone global pnpm now shows up as `MIGRATE`).
- `cloud` profile (off by default) with the `awscli` Homebrew formula (`aws`), replacing the standalone macOS `.pkg` AWS CLI install. First concrete target of the migrate-then-bootstrap flow.
- `bin/bootstrap`, `bin/doctor`, `bin/nightly` — thin executable entrypoints wiring `src/args.js` parsing to the `src/` functions with a real `CommandRunner`. These are the binaries declared in `package.json` and exercised by the e2e dry-run tests.
- `tools/provenance.sh` — read-only audit of how a given set of commands actually got installed. Resolves each binary through its symlink chain, classifies the owning manager (Homebrew formula/cask, standalone pnpm, pnpm global, pnpm-managed Node, Volta, npm global, macOS `.pkg` receipt via `pkgutil`, or a manual `/usr/local` drop), and compares against the manifest to label each tool OK / MIGRATE / UNMANAGED. Prints suggested cleanup commands but never changes the machine. Groundwork for a deterministic migrate-then-bootstrap flow.

## [0.2.1] - 2026-06-10
### Changed
- `./bin/bootstrap` profile prompt is now an arrow-key TUI on a real terminal. `↑/↓` (or `j/k`) navigate, `space` toggles the highlighted row, `a` toggles all, `enter` confirms, `q` / `esc` / `ctrl-c` cancel. Replaces the previous "press Y four times" per-profile yes/no prompt.
- Non-TTY contexts (CI, redirected stdin, tests injecting a `prompt`) automatically fall back to the per-profile yes/no flow so unattended runs keep working.

### Notes
- No behavior change for `--yes`, `--profiles=`, `--reconfigure`, or saved-selection runs. Idempotency unchanged — `ensureFormula` / `ensureCask` still skip already-installed packages.

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
