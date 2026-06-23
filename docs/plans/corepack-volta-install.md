# Install Corepack via Volta so pnpm lands on PATH

## Context

When the `node` profile is enabled, bootstrap is supposed to leave the machine
with a working `corepack` (and therefore per-project `pnpm`/`yarn` via each
project's `packageManager` field). It does not.

`ensureCorepack` currently resolves corepack with `volta which corepack` — a
path *inside* the Node image (`~/.volta/tools/image/node/<v>/bin/corepack`) — and
runs `corepack enable` from there. The problem is specific to Volta:

- Volta only exposes tools on `PATH` that were installed with `volta install`.
  The Node image's `bin/` is not on `PATH`; only `~/.volta/bin` is.
- Bootstrap never runs `volta install corepack`, so no `~/.volta/bin/corepack`
  shim is created. `corepack` resolves to nothing → `corepack: command not
  found`.
- Running `corepack enable` from the image path writes shims into a directory
  Volta never surfaces, so nothing usable lands on `PATH` either.

Net effect: after a "successful" bootstrap, neither `corepack` nor `pnpm` is
callable. `mac-bootstrap doctor` then fails its `corepack --version` check
(`src/doctor.js`), because doctor correctly expects corepack on `PATH` while
bootstrap never puts it there — the two halves of the tool disagree.

This was reproduced on a real laptop (ranger preset): the operator had to run
`volta install corepack` by hand, then `corepack enable` in the project, before
`pnpm i` worked. That manual `volta install corepack` is the missing step.

The prior change logged in CHANGELOG `0.5.1` ("enables Corepack through Volta's
resolved Node image") is the source of this bug and is superseded here.

## Desired Behavior

After bootstrap with the `node` profile:

- `~/.volta/bin/corepack` exists and is on `PATH`.
- `corepack --version` succeeds (so `doctor` passes).
- Per-project pnpm/yarn still come from each project's `packageManager` field;
  pnpm is never installed globally.

## Proposed Changes

1. `src/bootstrap.js` — `ensureCorepack`:
   - Run `volta install corepack` first to create the `~/.volta/bin/corepack`
     shim, then run `corepack enable` as a bare PATH command.
   - Surface a clear error if either step fails.
   - Delete the now-unused `resolveCorepackCommand` helper.
   - Update the `[dry-run]` plan to print `volta install corepack`.

2. `test/helpers.js` — `FakeRunner`:
   - Only derive `nodeVersion` from `volta install node@...`; treat
     `volta install corepack` as a plain success so it does not clobber the
     fake Node version.

3. `test/bootstrap.test.js`:
   - Replace the assertion on the Node-image `corepack enable` path with
     assertions that bootstrap runs `volta install corepack` and `corepack
     enable` (a bare command now on PATH).

4. Docs/help accuracy:
   - `src/help.js` corepack topic: bootstrap runs `volta install corepack` then
     `corepack enable`.
   - `src/help.js` diagnostics remediation: "missing Corepack" → run
     `volta install corepack` (not `corepack enable`, which cannot help when no
     shim exists).
   - `docs/runbooks/bootstrap.md` Project Runtime Versions: show
     `volta install corepack` once per machine alongside `corepack enable`.

## Validation

```sh
npm test
```

Expected: the corepack bootstrap test asserts `volta install corepack` and
`corepack enable`; all existing tests stay green.

Manual smoke test on a Mac:

```sh
mac-bootstrap bootstrap --preset ranger
which corepack        # ~/.volta/bin/corepack
corepack --version
mac-bootstrap doctor  # Corepack check passes
```

## Non-Goals

- Adding a `pnpm` check to `doctor` (doctor's corepack check is already correct
  once the shim exists). Tracked separately if desired.
- Changing the per-project pnpm/yarn model (still `packageManager` via
  Corepack; no global pnpm).
- Touching `mac-scripts` PATH wiring; that repo only orders tools, it does not
  install them.
