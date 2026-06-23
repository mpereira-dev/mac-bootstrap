# Bootstrap Runbook

Use this runbook when setting up a fresh or brownfield Apple Silicon Mac.

## Fresh Setup

From a checkout:

```sh
./bin/mac-bootstrap bootstrap --dry-run
./bin/mac-bootstrap bootstrap
./bin/mac-bootstrap doctor
```

The first real bootstrap may install Xcode CLI tools, Homebrew at
`/opt/homebrew`, Volta-managed Node `24`, Corepack, uv-managed Python `3.12`,
selected Homebrew formulae and casks, and basic directories under
`~/Library`.

## Brownfield Setup

On an existing laptop, start with read-only checks:

```sh
./bin/mac-bootstrap bootstrap --dry-run
./bin/mac-bootstrap migrate
./bin/mac-bootstrap doctor
```

Then run one of these:

```sh
./bin/mac-bootstrap bootstrap --reconfigure
./bin/mac-bootstrap bootstrap --preset ranger
./bin/mac-bootstrap bootstrap --profiles=core,node,cloud
```

`migrate` is plan-only by default. Use `--apply` only after reviewing the
planned installs and removals.

## Profiles

Packages are grouped by profiles in `packages.json`:

| Profile | Default | Purpose |
|---|---:|---|
| `core` | yes | Shell and repository baseline |
| `node` | yes | Volta, Node, and Corepack |
| `python` | yes | uv and Poetry |
| `ai` | no | AI provider CLIs |
| `mobile` | no | Flutter, Android Studio, and CocoaPods |
| `network` | no | Tailscale |
| `cloud` | no | AWS CLI, CDK, and Terraform |

On an interactive terminal, `bootstrap` opens a profile picker and saves the
choice to `~/.mac-bootstrap/profiles.json`. Later bootstrap, doctor, and nightly
runs reuse that saved choice unless you pass `--reconfigure`.

Useful non-interactive flags:

```sh
./bin/mac-bootstrap bootstrap --yes
./bin/mac-bootstrap bootstrap --profiles=core,node,cloud
./bin/mac-bootstrap bootstrap --reconfigure
```

`--yes` uses the saved selection, or the manifest defaults when no selection has
been saved.

## Presets

Presets are one-word names that expand to profiles:

| Preset | Profiles | Purpose |
|---|---|---|
| `scout` | core, node, python | Basic development machine |
| `ranger` | core, node, python, cloud | Cloud workstation |
| `falcon` | core, node, python, ai, network | Connected AI workstation |
| `ace` | core, node, python, ai, mobile | Mobile and AI workstation |
| `maverick` | all profiles | Everything |

Run this for the live table:

```sh
./bin/mac-bootstrap help bootstrap presets
```

## Migration

`tools/provenance.sh` audits how tools were installed and labels each one as
`OK`, `MIGRATE`, or `UNMANAGED`.

`migrate` turns that audit into an action plan:

```sh
./bin/mac-bootstrap migrate aws node
./bin/mac-bootstrap migrate --apply aws node
```

With `--apply`, the managed replacement is installed first. The old copy is
removed only after the replacement lands. Removals that need human judgment are
printed for you instead of being run automatically.

## Project Runtime Versions

Use project metadata for project-specific versions:

```sh
volta pin node@24          # per-project Node
volta install corepack     # once per machine: puts corepack on PATH
corepack enable            # activate the pnpm/yarn shims
```

Example `package.json` field:

```json
{
  "packageManager": "pnpm@10.18.0"
}
```

Do not install pnpm globally for normal project work. Corepack should provide
pnpm and yarn from each project's metadata.
