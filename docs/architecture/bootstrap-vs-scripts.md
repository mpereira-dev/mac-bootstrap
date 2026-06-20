# Bootstrap vs Scripts

`mac-bootstrap` and `mac-scripts` work together, but they have different jobs.
Keeping that split clear makes brownfield laptops easier to repair.

## Responsibilities

| Repo | Main job | Runs when | Examples |
|---|---|---|---|
| `mac-bootstrap` | Install and verify the machine baseline | Bootstrap, doctor, migrate, nightly | Homebrew formulae, casks, Volta, Corepack, Python tooling, launchd upkeep |
| `mac-scripts` | Shape the interactive shell | Every shell startup | PATH order, aliases, helper functions, shell prompt, optional private scripts |

`mac-bootstrap` should answer, "Is the right software installed and healthy?"

`mac-scripts` should answer, "When I open a terminal, do commands resolve the
way I expect?"

## Shell Profile Order

Use this order in `~/.zshrc` when both repos are installed:

```sh
# mac-bootstrap managed baseline
# ...

# >>> dx scripts >>>
source /path/to/mac-scripts/src/source_all.sh && source_all
# <<< dx scripts <<<
```

`mac-bootstrap` establishes the baseline environment. `mac-scripts` runs after
that and repairs daily shell behavior, including keeping Volta ahead of
Homebrew and legacy pnpm-managed Node paths.

## Runtime Model

`mac-bootstrap` installs version managers, not one global runtime for every
project:

- Node comes from Volta. Projects can pin their own Node version with
  `volta pin node@X`.
- pnpm and yarn come from Corepack. Projects pin package-manager versions with
  the `packageManager` field in `package.json`.
- Python comes from uv. Projects pin Python with uv metadata such as
  `uv python pin` or `requires-python`.

This lets project A and project B use different versions without fighting over
one machine-wide install.

## Non-Goals

`mac-bootstrap` should not manage interactive aliases, prompt styling, or daily
shell shortcuts.

`mac-scripts` should not install Homebrew packages, remove old packages, or run
nightly system upkeep.
