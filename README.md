# mac-bootstrap

`mac-bootstrap` sets up and checks an Apple Silicon macOS development laptop.
It installs the approved tool baseline, keeps that baseline healthy, and fails
loudly when the machine drifts.

This repo owns what is installed: Homebrew packages, casks, Volta, Node,
Corepack, Python tooling, selected profile presets, health checks, migrations,
security checks, and the optional nightly upkeep job.

For shell aliases and PATH behavior, use the sibling
[`mac-scripts`](https://github.com/mpereira-dev/mac-scripts) repo.

## Prerequisites

- Apple Silicon macOS.
- Network access.
- A checkout of this repo.
- Homebrew is expected at `/opt/homebrew`; bootstrap can install it when needed.

## Quick Start

Preview the work:

```sh
./bin/mac-bootstrap bootstrap --dry-run
```

Run bootstrap:

```sh
./bin/mac-bootstrap bootstrap
```

Check the machine afterward:

```sh
./bin/mac-bootstrap doctor
```

`./bin/mac-bootstrap` is a shell-safe cold-start wrapper. If Node is missing,
the `bootstrap` command installs enough Homebrew, Volta, and Node `24` to start
the full Node CLI.

## Common Commands

```sh
./bin/mac-bootstrap bootstrap --reconfigure
./bin/mac-bootstrap bootstrap --preset ranger
./bin/mac-bootstrap bootstrap --profiles=core,node,cloud
./bin/mac-bootstrap migrate
./bin/mac-bootstrap nightly --dry-run
./bin/mac-bootstrap security
./bin/mac-bootstrap help bootstrap presets
```

Compatibility shortcuts such as `./bin/bootstrap`, `./bin/doctor`, and
`./bin/security` still work, but the main surface is `./bin/mac-bootstrap`.

## Docs

- [Bootstrap runbook](docs/runbooks/bootstrap.md) explains profiles, presets,
  brownfield setup, migration, and per-project runtime versions.
- [Maintenance runbook](docs/runbooks/maintenance.md) explains `doctor`,
  `nightly`, launchd, Discord summaries, and security checks.
- [Bootstrap vs scripts architecture](docs/architecture/bootstrap-vs-scripts.md)
  explains what this repo owns and what `mac-scripts` owns.
- [Tool choice decision](docs/decisions/0001-tool-choice.md) explains why the
  main implementation uses Node.

## Test

```sh
npm test
```

Tests use fake command runners and isolated temporary homes. They do not invoke
real install commands.
