// FileVault module — detect / suggest / apply (idempotent).
// Threat model: laptop theft. FileVault encrypts the disk at rest; without it,
// a stolen laptop = readable user data via target-disk mode.
//
// IMPORTANT for Nightshift: with FileVault ON, a reboot waits at the unlock
// screen until someone types the password. LaunchAgents (Nightshift!) only
// fire after first login. If the laptop reboots while owner is away, jobs
// die. Workaround: don't reboot unattended, or use `sudo fdesetup authrestart`
// for planned reboots (unlocks once for a single restart).

export const name = "filevault";

export async function detect({ runner } = {}) {
  if (!runner) throw new Error("filevault.detect: runner is required");
  const result = await runner.run("fdesetup", ["status"]);
  if (result.exitCode !== 0) {
    return { ok: false, enabled: null, error: `fdesetup status exited ${result.exitCode}`, detail: result.stderr };
  }
  const out = (result.stdout || "").trim();
  const enabled = /FileVault is On/i.test(out);
  return { ok: true, enabled, detail: out };
}

export async function suggest({ current } = {}) {
  if (!current?.ok) return { advice: "cannot determine FileVault state — investigate `fdesetup status`" };
  if (current.enabled) return { advice: "FileVault enabled — no action" };
  return {
    advice: "FileVault is OFF. Enable it to protect data at rest.",
    command: "sudo fdesetup enable",
    notes: [
      "Outputs a 24-char recovery key — STORE IT in your password manager",
      "Does NOT require a reboot to enable (encrypts in background)",
      "Reboot-while-away gotcha: LaunchAgents (Nightshift) won't fire until someone logs in",
      "For planned reboots away from keyboard, use: sudo fdesetup authrestart"
    ]
  };
}

export async function apply({ runner, logger = console, dryRun = false } = {}) {
  if (!runner) throw new Error("filevault.apply: runner is required");
  const current = await detect({ runner });
  if (!current.ok) {
    logger.log(`filevault: cannot determine state — ${current.error || "detect failed"}`);
    return { changed: false, error: current.error || "detect failed" };
  }
  if (current.enabled) {
    logger.log("filevault: already enabled — noop");
    return { changed: false };
  }
  if (dryRun) {
    logger.log("filevault: DRY RUN — would run `sudo fdesetup enable` (interactive)");
    return { changed: false, dryRun: true };
  }
  // We do NOT run `sudo fdesetup enable` non-interactively because it requires:
  // 1) the user's password to authorize, and
  // 2) immediate capture of the recovery key.
  // Both are too risky to automate.
  logger.log("filevault: enable requires interactive sudo + recovery-key capture.");
  logger.log("filevault: run manually — `sudo fdesetup enable` — and store the recovery key in your password manager.");
  return { changed: false, manualStep: "sudo fdesetup enable" };
}
