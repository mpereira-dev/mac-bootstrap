# Changelog

## [0.6.1] - 2026-06-20
### Fixed
- Changed `nightly`'s npm-global updater from `npm install` to `npm update` to respect existing major versions and avoid applying breaking changes unattended.

## [0.6.0] - 2026-06-20
### Added
- `--install` flag for `mac-bootstrap nightly` to dynamically generate and load the launchd job.

### Changed
- Converted `launchd/com.mac-bootstrap.nightly.plist` to a template to prevent personal checkout paths from being committed.

## [0.5.2] - 2026-06-20
### Changed
- Slimmed the README to purpose, prerequisites, quick start, command examples, and documentation links.
- Moved bootstrap, brownfield setup, maintenance, and `mac-scripts` ownership details into focused runbook and architecture docs.

## [0.5.1] - 2026-06-20
### Fixed
- Bootstrap now enables Corepack through Volta's resolved Node image when no `corepack` PATH shim exists.

## [0.5.0] - 2026-06-17
### Added
- `./bin/mac-bootstrap` is now the canonical single operator surface with `bootstrap`, `doctor`, `nightly`, `migrate`, `security`, and deep `help` subcommands.
- The outer `mac-bootstrap` entrypoint is POSIX shell, so `bootstrap` can cold-start Homebrew, Volta, and Node 24 before handing off to the Node CLI.
- E2E coverage now verifies the single command, legacy shims, and no-Node bootstrap dry-run behavior.

### Changed
- Existing `./bin/bootstrap`, `./bin/doctor`, `./bin/nightly`, `./bin/migrate`, and `./bin/security` are compatibility shims into `mac-bootstrap <command>`.
- Help menus and interactive selection menus now print plain usage text instead of structured `[INFO]` log labels.
- README and command help now prefer `mac-bootstrap <command>` examples.

## [0.4.0] - 2026-06-17
### Added
- `./bin/security` is now a first-class CLI with deep help topics and an npm bin entrypoint.
- Security hardening now detects and applies targeted cleanup for quarantined nested Homebrew Cask helper binaries, including Codex's bundled `codex-path/rg`.
- Nightly upkeep now reruns the targeted Cask helper quarantine sweep after `brew upgrade --cask`.
- Doctor now reports each check as it completes and detects quarantined nested helpers in enabled Homebrew Casks.
- Deep help topics were added for doctor, nightly, migrate, and security operational workflows.

### Changed
- Doctor checks CLI casks by their usable command, so `antigravity-cli` validates through the official `agy` command.
- Help usage and examples now prefer repo-local `./bin/...` entrypoints.
- Security dry-run mode now performs real read-only detection; `--dry-run` only affects `--apply`.

### Fixed
- Security apply refuses FileVault, firewall, or SSH changes when the current state cannot be determined safely.
- Doctor package checks are bounded with timeouts so slow or stuck commands do not hang forever before producing output.

## [0.3.0] - 2026-06-17
### Added
- Terraform CLI support in the `cloud` profile via `hashicorp/tap/terraform`.
- Structured CLI logging with `[DEBUG]`, `[INFO]`, `[WARN]`, and `[ERROR]` labels plus terminal colors.

### Changed
- Node baseline moved from `22` to `24` across bootstrap, doctor, migrate, docs, tests, and package engines.
- `ranger` and `maverick` now include Terraform through the `cloud` profile.

### Removed
- Bun is no longer installed or documented by the `node` profile.

## [0.2.2] - 2026-06-17
### Added
- **`python` profile** (on by default) — `uv` + `poetry`. uv owns Python interpreters (replacing brew `python`): bootstrap seeds Python `3.12`, and projects pin their own with `uv python pin` / `requires-python`. doctor checks `uv` + `poetry`. `python` was removed from `core`.
- **Presets** — one-word codenames in `packages.json` that expand to a profile set: `scout`, `ranger`, `falcon`, `ace`, `maverick`. Use with `./bin/bootstrap --preset NAME` (behaves like `--profiles`: no prompt, selection saved). `./bin/bootstrap --help presets` shows the table.
- **`bin/migrate`** (+ `src/migrate.js`) — the act-on-it half of the migrate-then-bootstrap flow. Consumes `tools/provenance.sh --json`, and for every tool flagged `MIGRATE` it installs the mac-bootstrap-managed version (brew/Volta) then removes the old copy. Plan-only by default; `--apply` executes (the flag is the confirmation — no second prompt). The managed install runs first and is idempotent; the old copy is removed only after it lands. Removals needing human judgement (`.pkg` receipts, `<placeholder>` versions, manual drops) are printed, never auto-run.
- `tools/provenance.sh --json` — machine-readable output mode consumed by `bin/migrate`.
- **Corepack** — `./bin/bootstrap` runs `corepack enable` when the `node` profile is on; `./bin/doctor` checks it. Per-project `pnpm`/`yarn` via the `package.json` `"packageManager"` field; no global pnpm (a standalone one shows up as `MIGRATE`).
- `cloud` profile — `awscli` (replaces the standalone macOS `.pkg`) and `aws-cdk` (command `cdk`).
- **Nested, topic-based CLI help** across all commands (`--help`, `--help <topic>`, `--help <topic> <subtopic>`). `./bin/bootstrap --help profiles` and `--help presets` render pretty tables; `migrate --help detection|verdicts|removal` documents how installs are found and removed.
- `bin/bootstrap`, `bin/doctor`, `bin/nightly`, `bin/migrate` — thin executable entrypoints declared in `package.json` and exercised by the e2e tests.
- `tools/provenance.sh` — read-only audit of how each command got installed (symlink-chain resolution + manager classification: Homebrew formula/cask, standalone pnpm, pnpm global, pnpm-managed Node, Volta, npm global, macOS `.pkg` receipt, or a manual `/usr/local` drop), labelling each OK / MIGRATE / UNMANAGED. Never changes the machine.

### Changed
- `ai` profile is now **off by default**. Default profiles are `core`, `node`, `python`.

### Fixed
- CLI entrypoints now dispatch nested help through `src/help.js` instead of importing removed `*Help` exports.
- Added the advertised `bin/migrate` executable so `mac-bootstrap-migrate` and `./bin/migrate` work.
- `./bin/bootstrap --dry-run --preset NAME` no longer writes `~/.mac-bootstrap/profiles.json`.

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
