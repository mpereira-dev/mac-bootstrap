# Maintenance Runbook

Use this runbook for health checks, nightly upkeep, and security checks.

## Doctor

Run:

```sh
./bin/mac-bootstrap doctor
```

Doctor checks the expected directories, launchd template, installed launchd job
when present, shell baseline, Xcode CLI tools, enabled Homebrew formulae, cask
commands, GUI casks, quarantined nested Homebrew Cask helpers, Volta, and the
expected Node major version when the `node` profile is enabled.

It exits non-zero when expected state drifts.

## Nightly Upkeep

Preview:

```sh
./bin/mac-bootstrap nightly --dry-run
```

Nightly is designed for launchd. It runs Homebrew update and upgrade steps,
updates enabled self-updating tools such as Claude when present, captures
before and after version snapshots, and writes logs to:

```sh
~/Library/Logs/mac-bootstrap-nightly.log
```

Logs are rotated with seven-day retention.

If `DISCORD_WEBHOOK_URL` is set in the runtime environment, nightly posts a
summary to that webhook. Without the variable, it does not post to Discord.

## Launchd

The launchd template lives at:

```sh
launchd/com.mac-bootstrap.nightly.plist
```

To automatically configure paths and install it into launchd:

```sh
./bin/mac-bootstrap nightly --install
```

This dynamically substitutes `__NIGHTLY_BIN__` and other variables for your actual absolute paths, preventing you from checking in personal paths to GitHub.

## Cask Quarantine Cleanup

After cask upgrades, nightly strips `com.apple.quarantine` only from nested
helper binaries inside Homebrew Caskroom payloads. This is intentionally narrow.
It does not sweep `~/Downloads` or `/Applications`.

This can look automation-like to some endpoint scanners because it updates
software and changes quarantine metadata. The scope is limited to
Homebrew-managed cask helper files so tools do not repeatedly trigger Gatekeeper
after legitimate cask updates.

## Security

Run:

```sh
./bin/mac-bootstrap security
./bin/mac-bootstrap security --dry-run --apply
```

Security is read-only by default. It checks FileVault, the macOS Application
Firewall, Remote Login / SSH, and quarantined nested Homebrew Cask helpers.

`--apply` performs automated fixes where the tool can do so safely. FileVault
enablement remains manual because the recovery key must be captured and stored
immediately.
