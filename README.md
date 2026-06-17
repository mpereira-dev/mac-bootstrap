# mac-bootstrap

Deterministic macOS laptop bootstrap and nightly upkeep for an Apple Silicon macOS development laptop. This repository installs the owner-approved baseline, keeps it current with a launchd-compatible nightly job, and provides a doctor command that fails loudly when expected state drifts.

This repo is Apple Silicon only. Homebrew is expected at `/opt/homebrew`.

## Bootstrap a Fresh Laptop

Prerequisites are macOS and network access. From a fresh checkout:

```sh
./bin/bootstrap --dry-run
./bin/bootstrap
```

`bin/bootstrap` ensures Xcode CLI tools, Homebrew at `/opt/homebrew`, the curated Homebrew formulae and casks in `packages.json`, Volta-managed Node `24`, Corepack enabled for per-project `pnpm`/`yarn`, uv-managed Python `3.12`, minimal zsh shell setup, and `~/Library/LaunchAgents` plus `~/Library/Logs`.

## Profiles

Packages are grouped by profiles in `packages.json`:

- `core`: shell and repository baseline. On by default.
- `node`: Node.js runtime (Volta) and Corepack for per-project `pnpm`/`yarn`. On by default.
- `python`: uv (interpreters + packaging) and Poetry. On by default.
- `ai`: AI provider CLIs. Off by default.
- `mobile`: Flutter, Android Studio, and CocoaPods. Off by default.
- `network`: Tailscale. Off by default.
- `cloud`: AWS CLI, CDK, and Terraform. Off by default.

On a fresh laptop, `./bin/bootstrap` opens an arrow-key picker for the profiles to enable, saves the selection to `~/.mac-bootstrap/profiles.json`, and reuses it on later runs. Controls: `↑/↓` (or `j/k`) navigate, `space` toggles the highlighted row, `a` toggles all, `enter` confirms, `q` / `esc` / `ctrl-c` cancel. Every profile is offered; off-by-default ones just start unchecked.

In non-TTY contexts (CI, redirected stdin) the picker falls back to a per-profile yes/no prompt automatically.

Non-interactive flags:

```sh
./bin/bootstrap --yes
./bin/bootstrap --preset ranger
./bin/bootstrap --profiles=core,node,cloud
./bin/bootstrap --reconfigure
```

`--yes` skips the prompt and uses the saved selection, or the manifest defaults when no saved file exists. `--profiles=A,B` installs exactly those profiles and saves the selection. `--reconfigure` ignores the saved selection and prompts again.

### Presets

Presets are one-word codenames that expand to a set of profiles, so you get the same laptop with one word on every machine. `--preset NAME` behaves like `--profiles` (no prompt, selection saved). Run `./bin/bootstrap --help presets` for the table.

| Preset | Profiles | Purpose |
|---|---|---|
| `scout` | core, node, python | Any machine: shell + Node + Python baseline |
| `ranger` | core, node, python, cloud | Cloud workstation (AWS + Terraform tooling) |
| `falcon` | core, node, python, ai, network | Connected workstation (AI + Tailscale) |
| `ace` | core, node, python, ai, mobile | Mobile + AI rig (Flutter stack + AI CLIs) |
| `maverick` | all profiles | Everything |

Edit the `presets` block in `packages.json` to rename or add your own.

Run `./bin/bootstrap --help` for nested, topic-based help: `--help profiles` prints the profile table, and every command supports `--help <topic> [subtopic]` (e.g. `./bin/migrate --help detection`).

`bin/doctor` and `bin/nightly` read the same saved selection. If no saved selection exists, they use the manifest defaults.

The package manifest is intentionally curated. It is seeded from the current laptop, but it includes only packages that are expected to be first-class development tools rather than every transitive dependency.

## Per-Project Runtime Versions

`mac-bootstrap` installs the *version managers*, not pinned runtimes, so different projects can use different versions without conflict:

- **Node** is provided by Volta. A project pins its own version with `volta pin node@X`; Volta auto-switches per directory.
- **pnpm / yarn** are provided by Corepack (`corepack enable` runs during bootstrap when the `node` profile is on). A project pins its exact version in `package.json` with `"packageManager": "pnpm@10.x"`. Do not install pnpm globally — `bin/migrate` flags a standalone global pnpm as something to migrate onto Corepack.
- **Python** is provided by uv (the `python` profile installs `uv` + `poetry`). uv owns the interpreters — bootstrap seeds Python `3.12`, and a project pins its own with `uv python pin 3.x` or `requires-python`. No brew `python`; uv replaces it. Poetry is installed alongside for existing Poetry projects during the transition to uv.

## Migrate Existing Installs

`tools/provenance.sh` audits how each tool was actually installed (Homebrew, Volta, Corepack, a standalone pnpm/npm global, a macOS `.pkg`, or a manual drop) and labels it `OK` / `MIGRATE` / `UNMANAGED`. It never changes anything.

`bin/migrate` acts on that audit:

```sh
./bin/migrate aws node            # plan only — show what would change
./bin/migrate --apply aws node    # install the managed version, then remove the old one
```

Plan-only by default. `--apply` is the confirmation — it installs the mac-bootstrap-managed version first (idempotent), and only then removes the old copy, with no second prompt. Removals that need human judgement — `.pkg` receipts, version placeholders, manual `/usr/local` drops — are printed for you to handle rather than run automatically. With no tool arguments it audits the default set (`brew pnpm aws cdk node`).

## Nightly Upkeep

`bin/nightly` is designed for launchd and runs these steps:

```sh
brew update
brew upgrade
brew upgrade --cask
claude update
```

After cask upgrades, nightly also strips `com.apple.quarantine` from nested Homebrew Cask helper binaries such as Codex's bundled `codex-path/rg`. This is intentionally targeted to Homebrew-managed Caskroom payloads so a Codex update does not bring back the Gatekeeper "`rg` Not Opened" prompt.

Self-update commands such as `claude update` only run for casks in enabled profiles. If `packages.json` later pins npm globals, nightly updates those too. It writes to `~/Library/Logs/mac-bootstrap-nightly.log`, rotates prior logs with seven-day retention, captures before/after version snapshots, and posts a Discord summary only when `DISCORD_WEBHOOK_URL` is present in the runtime environment.

The launchd template lives at `launchd/com.mac-bootstrap.nightly.plist`. It is intentionally not loaded by this repository; install it only after review by copying it to `~/Library/LaunchAgents/` and loading it with `launchctl bootstrap`.

## Verify Health

```sh
./bin/doctor
```

Doctor checks expected directories, the launchd template, the launchd job if the plist has been installed, shell baseline, Xcode CLI tools, enabled Homebrew formulae, CLI commands provided by enabled casks, GUI casks without commands, quarantined nested helpers in enabled Homebrew Casks, Volta, and the expected major Node version when the `node` profile is enabled. It exits non-zero on drift.

## Security Hardening

```sh
./bin/security
./bin/security --dry-run --apply
```

Security is read-only by default: it detects and suggests hardening for FileVault, the macOS Application Firewall, Remote Login / SSH, and quarantined nested helper binaries inside Homebrew Casks. `--apply` performs the automated steps where safe; FileVault enablement remains manual because the recovery key must be captured and stored immediately. The Cask quarantine cleanup only targets helper binaries under Homebrew's Caskroom, not `~/Downloads` or `/Applications` broadly. Use `./bin/security --help modules` or `./bin/security --help cask-quarantine` for the deeper menu.

## Shell Environment

`mac-bootstrap` handles installation. The sibling [`mac-scripts`](https://github.com/mpereira-dev/mac-scripts) repository handles shell PATH and environment wiring.

## Extend

Edit `packages.json` for formulae, casks, Node default, and npm-global pins. Add tests for each behavioral change before relying on it for unattended maintenance. Use `./bin/bootstrap --dry-run`, `./bin/nightly --dry-run`, and `./bin/doctor --dry-run` to inspect planned actions without changing the machine.

## Test

```sh
npm test
```

Tests use fake command runners and isolated temporary homes. They do not invoke real install commands.
