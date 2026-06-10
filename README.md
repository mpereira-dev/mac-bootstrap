# mac-bootstrap

Deterministic macOS laptop bootstrap and nightly upkeep for an Apple Silicon macOS development laptop. This repository installs the owner-approved baseline, keeps it current with a launchd-compatible nightly job, and provides a doctor command that fails loudly when expected state drifts.

This repo is Apple Silicon only. Homebrew is expected at `/opt/homebrew`.

## Bootstrap a Fresh Laptop

Prerequisites are macOS and network access. From a fresh checkout:

```sh
./bin/bootstrap --dry-run
./bin/bootstrap
```

`bin/bootstrap` ensures Xcode CLI tools, Homebrew at `/opt/homebrew`, the curated Homebrew formulae and casks in `packages.json`, Volta-managed Node `22`, minimal zsh shell setup, and `~/Library/LaunchAgents` plus `~/Library/Logs`.

## Profiles

Packages are grouped by profiles in `packages.json`:

- `core`: shell and repository baseline.
- `node`: Node.js runtime and JavaScript tooling.
- `ai`: AI provider CLIs.
- `mobile`: Flutter, Android Studio, and CocoaPods.
- `network`: Tailscale.

On a fresh laptop, `./bin/bootstrap` opens an arrow-key picker for the profiles to enable, saves the selection to `~/.mac-bootstrap/profiles.json`, and reuses it on later runs. Controls: `↑/↓` (or `j/k`) navigate, `space` toggles the highlighted row, `a` toggles all, `enter` confirms, `q` / `esc` / `ctrl-c` cancel. `mobile` and `network` are off by default.

In non-TTY contexts (CI, redirected stdin) the picker falls back to a per-profile yes/no prompt automatically.

Non-interactive flags:

```sh
./bin/bootstrap --yes
./bin/bootstrap --profiles=core,node,ai
./bin/bootstrap --reconfigure
```

`--yes` skips the prompt and uses the saved selection, or the manifest defaults when no saved file exists. `--profiles=A,B` installs exactly those profiles and saves the selection. `--reconfigure` ignores the saved selection and prompts again.

`bin/doctor` and `bin/nightly` read the same saved selection. If no saved selection exists, they use the manifest defaults.

The package manifest is intentionally curated. It is seeded from the current laptop, but it includes only packages that are expected to be first-class development tools rather than every transitive dependency.

## Nightly Upkeep

`bin/nightly` is designed for launchd and runs these steps:

```sh
brew update
brew upgrade
brew upgrade --cask
claude update
```

Self-update commands such as `claude update` only run for casks in enabled profiles. If `packages.json` later pins npm globals, nightly updates those too. It writes to `~/Library/Logs/mac-bootstrap-nightly.log`, rotates prior logs with seven-day retention, captures before/after version snapshots, and posts a Discord summary only when `DISCORD_WEBHOOK_URL` is present in the runtime environment.

The launchd template lives at `launchd/com.mac-bootstrap.nightly.plist`. It is intentionally not loaded by this repository; install it only after review by copying it to `~/Library/LaunchAgents/` and loading it with `launchctl bootstrap`.

## Verify Health

```sh
./bin/doctor
```

Doctor checks expected directories, the launchd template, the launchd job if the plist has been installed, shell baseline, Xcode CLI tools, enabled Homebrew formulae and casks, enabled cask commands, Volta, and the expected major Node version when the `node` profile is enabled. It exits non-zero on drift.

## Shell Environment

`mac-bootstrap` handles installation. The sibling [`mac-scripts`](https://github.com/mpereira-dev/mac-scripts) repository handles shell PATH and environment wiring.

## Extend

Edit `packages.json` for formulae, casks, Node default, and npm-global pins. Add tests for each behavioral change before relying on it for unattended maintenance. Use `./bin/bootstrap --dry-run`, `./bin/nightly --dry-run`, and `./bin/doctor --dry-run` to inspect planned actions without changing the machine.

## Test

```sh
npm test
```

Tests use fake command runners and isolated temporary homes. They do not invoke real install commands.
