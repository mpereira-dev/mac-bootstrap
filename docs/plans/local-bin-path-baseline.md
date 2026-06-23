# Add `~/.local/bin` to the managed shell PATH baseline

## Context

`ensureZshrc` writes a managed `~/.zshrc` block that puts Homebrew and Volta on
`PATH`:

```sh
# mac-bootstrap managed baseline
export HOMEBREW_PREFIX="/opt/homebrew"
if [ -x "$HOMEBREW_PREFIX/bin/brew" ]; then
  eval "$($HOMEBREW_PREFIX/bin/brew shellenv)"
fi
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"
# end mac-bootstrap managed baseline
```

There is no standard, always-on-`PATH` location for user-managed CLI launchers.
`~/.local/bin` is the conventional spot, but macOS does not put it on `PATH` by
default. As a result, an executable a developer places in `~/.local/bin` is not
found after bootstrap.

## Problem

User-managed CLI launchers in `~/.local/bin` do not resolve because the
directory is not on `PATH` after bootstrap.

## Desired Behavior

After bootstrap:

- `~/.local/bin` exists.
- `~/.local/bin` is on `PATH`, while Volta remains earliest so it still wins for
  Node/runtime shims.
- Machines with an existing managed block are upgraded in place to include the
  new line (not only fresh machines).

## Proposed Changes

1. `src/bootstrap.js` — `ensureDirectories`:
   - Add `path.join(home, ".local", "bin")` to the created directories.

2. `src/bootstrap.js` — `ensureZshrc`:
   - Add `export PATH="$HOME/.local/bin:$PATH"` to the managed block, placed
     **before** the `export PATH="$VOLTA_HOME/bin:$PATH"` line. Because each line
     prepends, the resulting order is `~/.volta/bin` first, then `~/.local/bin`,
     then the rest — Volta keeps precedence for runtimes while user launchers
     still resolve.
   - Upgrade path for existing machines: when the managed marker block already
     exists but does not contain the `~/.local/bin` line, patch the line into
     the existing block. The current append-only logic only writes the block
     when the marker is absent, so already-bootstrapped machines would otherwise
     never receive the new line. The patch must be idempotent (no duplicate
     lines on re-run).

3. `src/bootstrap.js` — `printBootstrapPlan` (dry-run):
   - Print the new `~/.local/bin` directory and the added PATH line.

4. `src/help.js`:
   - Mention `~/.local/bin` in the baseline description (the `bootstrap` help
     topic that lists managed PATH entries).

5. `src/doctor.js` (optional but recommended):
   - Add a check that `~/.local/bin` exists and is on `PATH`; remediation hint =
     re-run `mac-bootstrap bootstrap` for this HOME.

6. Tests:
   - `test/bootstrap.test.js`: assert `~/.local/bin` is created and the written
     `.zshrc` baseline contains `export PATH="$HOME/.local/bin:$PATH"` ahead of
     the Volta line.
   - Add a test for the upgrade path: a HOME whose `.zshrc` already has the
     managed block without the `.local/bin` line gets the line added exactly
     once (idempotent on a second run).
   - `test-e2e` is unaffected (subprocess launch).

7. Version + CHANGELOG:
   - Bump minor `0.6.2` → `0.7.0` (new baseline capability).
   - `Added`: managed shell baseline now ensures `~/.local/bin` exists and is on
     `PATH` (behind Volta) for user-managed CLI launchers; existing managed
     blocks are upgraded in place.

## Validation

```sh
npm run test:unit
```

Expected: new assertions pass; all existing unit tests stay green.

Manual smoke test on a Mac:

- Fresh HOME: bootstrap creates `~/.local/bin` and writes the PATH line ahead of
  Volta; `echo $PATH` after `source ~/.zshrc` shows `~/.volta/bin` before
  `~/.local/bin`.
- Existing HOME with an older managed block: bootstrap adds the `.local/bin`
  line once; a second run makes no further change.

## Non-Goals

- Installing or symlinking any specific tool; this plan only guarantees the
  directory and its presence on `PATH`.
- Changing Homebrew/Volta/Corepack ordering beyond inserting `~/.local/bin`
  immediately behind Volta.
