# Single Operator Command Plan

## Executive Summary

`mac-bootstrap` should become the single operator surface, with subcommands for the
current tools:

```sh
mac-bootstrap bootstrap [args]
mac-bootstrap doctor [args]
mac-bootstrap nightly [args]
mac-bootstrap migrate [args]
mac-bootstrap security [args]
mac-bootstrap help [command] [topic...]
```

Keep every existing `./bin/<command>` and `mac-bootstrap-<command>` entrypoint as
a compatibility shim. This repo bootstraps its own dependency stack, so the
outer command must not require Node on a fresh machine. Use a tiny POSIX shell
wrapper for cold start, then delegate to the existing Node ESM modules, argument
parsers, `ConsoleLogger`, `CommandRunner`, and help tree after Node is available.

The recommended approach is a shell-safe `./bin/mac-bootstrap`, backed by an
in-process Node command registry in `src/cli.js`. The old wrappers become tiny
shell shims that call the shared surface with an explicit command. That gives
operators one surface without breaking launchd, docs, shell muscle memory, or
npm-installed aliases.

## Current Command Inventory

| Repo entrypoint | npm bin | Current behavior |
| --- | --- | --- |
| `./bin/mac-bootstrap` | `mac-bootstrap` | Shell cold-start wrapper; delegates to Node CLI when Node exists, or bootstraps Homebrew/Volta/Node for `bootstrap` |
| `./bin/bootstrap` | compatibility shortcut | Dispatches to `mac-bootstrap bootstrap` |
| `./bin/doctor` | `mac-bootstrap-doctor` | Dispatches to `mac-bootstrap doctor` |
| `./bin/nightly` | `mac-bootstrap-nightly` | Dispatches to `mac-bootstrap nightly` |
| `./bin/migrate` | `mac-bootstrap-migrate` | Dispatches to `mac-bootstrap migrate` |
| `./bin/security` | `mac-bootstrap-security` | Dispatches to `mac-bootstrap security` |

The shared help tree already lives in `src/help.js`, but usage text currently
prefers repo-local `./bin/<command>` examples. The first consolidation pass
should preserve that while introducing the canonical grouped command.

## Recommended Interface

Primary operator shape:

```sh
mac-bootstrap <command> [args]
```

Supported commands:

| Command | Purpose |
| --- | --- |
| `bootstrap` | Install the selected baseline |
| `doctor` | Stream and verify baseline drift checks |
| `nightly` | Run unattended Homebrew and self-update maintenance |
| `migrate` | Detect and move unmanaged tools onto managed installs |
| `security` | Detect and optionally apply local macOS hardening |
| `help` | Print root help or deep command help |

Backcompat rule:

```sh
mac-bootstrap --dry-run
mac-bootstrap --yes
mac-bootstrap --preset ranger
```

should continue to mean `mac-bootstrap bootstrap ...` for at least one release,
because earlier releases mapped `mac-bootstrap` directly to `./bin/bootstrap`.

## Implementation Shape

Add `src/cli.js` as the single Node dispatcher:

```js
const COMMANDS = {
  bootstrap: runBootstrap,
  doctor: runDoctor,
  nightly: runNightly,
  migrate: runMigrate,
  security: runSecurity
};

export async function main(argv) {
  // Resolve command, route help, construct logger/runner, return an exit code.
}
```

Then add `./bin/mac-bootstrap` as the cold-start shell wrapper:

```sh
#!/bin/sh
# If node exists, exec node src/cli.js "$@".
# If node is missing and the command is bootstrap, install Homebrew/Volta/Node.
# Otherwise print a clear "run bootstrap first" message.
```

Convert existing wrappers into shims:

```sh
#!/bin/sh
exec "$script_dir/mac-bootstrap" doctor "$@"
```

Move command-specific parsing out of `bin/migrate` and `bin/security` into
`src/cli.js` or small command modules. This keeps parsing testable and keeps
`bin/` limited to executable launchers.

## No-Dependency Options

| Option | Recommendation | Tradeoff |
| --- | --- | --- |
| Shell cold-start wrapper + in-process Node dispatcher | Use this | Fresh-machine safe, keeps the rich implementation testable, and avoids npm package deps |
| In-process Node dispatcher only | Avoid | Clean once Node exists, but fails on a fresh machine before bootstrap can install Node |
| Shell wrapper dispatching to current bins | Avoid | Smallest diff, but weaker portability and harder structured tests |
| Node wrapper spawning current bins | Avoid except as interim | Preserves behavior, but adds process overhead and stdout/stderr complexity |
| One large executable file | Avoid | Simple package surface, but loses the existing clean module boundaries |

## Migration Plan

1. Add `src/cli.js` and `./bin/mac-bootstrap`.
2. Update `package.json` so `mac-bootstrap` points to `./bin/mac-bootstrap`.
3. Keep existing npm aliases for compatibility:
   - `mac-bootstrap-doctor`
   - `mac-bootstrap-nightly`
   - `mac-bootstrap-migrate`
   - `mac-bootstrap-security`
4. Keep existing repo-local commands as shims:
   - `./bin/bootstrap`
   - `./bin/doctor`
   - `./bin/nightly`
   - `./bin/migrate`
   - `./bin/security`
5. Add root help for `mac-bootstrap --help` and `mac-bootstrap help`.
6. Keep command help compatible:
   - `mac-bootstrap doctor --help checks`
   - `mac-bootstrap help doctor checks`
   - `./bin/doctor --help checks`
7. Update README examples to show the grouped command first and legacy wrappers
   as compatibility shortcuts.
8. Leave launchd on `./bin/nightly` until the grouped command is proven in at
   least one release, then consider switching the plist template.

## Help Behavior

Root help should list commands and examples:

```text
Usage: mac-bootstrap <command> [args]

Commands:
  bootstrap  Install the owner-approved baseline
  doctor     Verify the laptop matches the expected baseline
  nightly    Run unattended maintenance
  migrate    Move unmanaged tools onto managed installs
  security   Detect and apply local security hardening
```

Deep help should remain comprehensive and route to the existing help tree:

```sh
mac-bootstrap help bootstrap profiles selection
mac-bootstrap bootstrap --help profiles selection
mac-bootstrap security --help cask-quarantine
```

For one release, copy/paste footers can mention both forms when useful:

```text
Run `mac-bootstrap help doctor checks` or `./bin/doctor --help checks`.
```

## Risks

- Bare `mac-bootstrap --dry-run` could break if treated as an unknown command.
- A fresh machine without Node could fail before bootstrap can install Node.
- `migrate` positional tools could be swallowed by the top-level parser.
- `security --dry-run --apply` semantics could drift if parsing is rewritten
  too broadly.
- Launchd could break if the nightly plist is updated too early.
- Existing help tests intentionally assert `./bin/<command>` usage strings.

## Test Plan

Add focused `node:test` coverage for:

- `mac-bootstrap --help` prints command list.
- `mac-bootstrap help security modules` reaches deep security help.
- `mac-bootstrap doctor --help checks` matches existing doctor topic help.
- `mac-bootstrap migrate aws node` preserves positional tools.
- `mac-bootstrap security --dry-run --apply` preserves apply dry-run behavior.
- Bare `mac-bootstrap --dry-run --home <tmp>` still dispatches to bootstrap.
- Existing `./bin/<command>` wrappers still pass current e2e help and dry-run
  tests.

## Recommendation

Implement the in-process dispatcher in one feature release, but keep old wrappers
and aliases indefinitely unless they become maintenance noise. The main value is
operator ergonomics, not deletion. A stable single command plus compatibility
shortcuts is the lowest-risk shape for a bootstrap repo.
