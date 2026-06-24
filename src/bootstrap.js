import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatCommand } from "./command-runner.js";
import { brewPath, filterByProfiles, loadManifest, repoRoot } from "./manifest.js";
import { checkNetwork } from "./network.js";
import { pickProfiles, pickProfilesInteractive } from "./prompt.js";
import { defaultProfiles, loadSelections, resolvePreset, saveSelections, selectionsPath } from "./selections.js";

export async function bootstrap({
  dryRun = false,
  yes = false,
  reconfigure = false,
  preset,
  profiles: profilesOverride,
  home = os.homedir(),
  manifestPath,
  runner,
  logger = console,
  promptLogger = logger,
  networkCheck = checkNetwork,
  prompt,
  interactive = Boolean(process.stdin && process.stdin.isTTY)
}) {
  const fullManifest = loadManifest(manifestPath);
  const saved = loadSelections(home);
  const defaults = defaultProfiles(fullManifest);

  // A preset (codename) resolves to a fixed profile list and behaves like an
  // explicit --profiles override: no prompt, selection saved.
  let effectiveOverride = profilesOverride;
  if (preset) {
    const presetProfiles = resolvePreset(fullManifest, preset);
    if (!presetProfiles) {
      logger.error(`Unknown preset: ${preset}. Available: ${Object.keys(fullManifest.presets || {}).join(", ") || "(none)"}`);
      return 2;
    }
    logger.log(`Preset "${preset}" → ${presetProfiles.join(", ")}`);
    effectiveOverride = presetProfiles;
  }

  const selectedProfiles = await resolveProfileSelection({
    fullManifest,
    saved,
    defaults,
    dryRun,
    profilesOverride: effectiveOverride,
    yes,
    reconfigure,
    home,
    logger,
    promptLogger,
    prompt,
    interactive
  });

  const manifest = filterByProfiles(fullManifest, selectedProfiles);

  if (dryRun) {
    printBootstrapPlan({ home, manifest, profiles: selectedProfiles, logger });
    return 0;
  }

  if (!(await networkCheck())) {
    logger.error("Network unavailable; bootstrap cannot install packages.");
    return 2;
  }

  ensureDirectories(home, logger);
  ensureZshrc(home, logger);
  const failures = [];
  if (!ensureSelfLauncher(home, logger).ok) {
    failures.push("self-launcher");
  }
  if (!ensureXcodeCli(runner, logger).ok) {
    failures.push("xcode-cli-tools");
  }
  if (!ensureHomebrew(runner, manifest, logger).ok) {
    failures.push("homebrew");
  }

  for (const formula of manifest.formulae) {
    const result = ensureFormula(runner, manifest, formula.name, logger);
    if (!result.ok) {
      failures.push(`formula:${formula.name}`);
    }
  }

  for (const cask of manifest.casks) {
    const result = ensureCask(runner, manifest, cask.name, logger);
    if (!result.ok) {
      failures.push(`cask:${cask.name}`);
    }
  }

  if (selectedProfiles.includes("node")) {
    const nodeResult = ensureVoltaNode(runner, manifest, logger);
    if (!nodeResult.ok) {
      failures.push(`node:${manifest.defaultNode}`);
    }
    if (!ensureCorepack(runner, home, logger).ok) {
      failures.push("corepack");
    }
  }

  if (selectedProfiles.includes("python")) {
    if (!ensureUvPython(runner, manifest, logger).ok) {
      failures.push(`python:${manifest.defaultPython}`);
    }
  }

  if (failures.length > 0) {
    logger.error(`Bootstrap completed with failures: ${failures.join(", ")}`);
    return 1;
  }

  logger.log("Bootstrap complete.");
  return 0;
}

// Decides which profiles to enable, in this priority:
//   1. --profiles=A,B  (explicit override; saves it).
//   2. saved selection on disk (unless --reconfigure).
//   3. --yes with no saved file: falls back to defaults from manifest.
//   4. otherwise prompt interactively and save the result.
async function resolveProfileSelection({
  fullManifest,
  saved,
  defaults,
  dryRun,
  profilesOverride,
  yes,
  reconfigure,
  home,
  logger,
  promptLogger,
  prompt,
  interactive
}) {
  if (Array.isArray(profilesOverride) && profilesOverride.length > 0) {
    if (dryRun) {
      logger.log(`[dry-run] using --profiles override without saving: ${profilesOverride.join(", ")}`);
      return profilesOverride;
    }
    saveSelections(home, profilesOverride);
    logger.log(`Using --profiles override and saving: ${profilesOverride.join(", ")}`);
    return profilesOverride;
  }
  if (saved && !reconfigure) {
    logger.log(`Using saved profile selection: ${saved.profiles.join(", ")} (re-run with --reconfigure to change)`);
    return saved.profiles;
  }
  if (yes) {
    const fallback = saved ? saved.profiles : defaults;
    logger.log(`--yes: using ${saved ? "saved" : "default"} profiles without prompt: ${fallback.join(", ")}`);
    return fallback;
  }

  // Use the arrow-key TUI on a real terminal; fall back to per-profile yes/no
  // when tests inject a `prompt` function or when stdin is not a TTY. Every
  // profile is offered; presets (--preset) are the shortcut for common combos.
  const promptDefaults = saved ? saved.profiles : defaults;
  let picked;
  if (typeof prompt === "function" || !interactive) {
    picked = await pickProfiles({ manifest: fullManifest, logger: promptLogger, defaults: promptDefaults, prompt });
  } else {
    picked = await pickProfilesInteractive({ manifest: fullManifest, defaults: promptDefaults });
  }
  const file = selectionsPath(home);
  if (dryRun) {
    logger.log(`[dry-run] would save profile selection to ${file}`);
    return picked;
  }
  saveSelections(home, picked);
  logger.log(`Saved profile selection to ${file}`);
  return picked;
}

export function printBootstrapPlan({ home, manifest, profiles, logger }) {
  logger.log("[dry-run] bootstrap plan");
  logger.log(`[dry-run] enabled profiles: ${profiles && profiles.length > 0 ? profiles.join(", ") : "(none)"}`);
  logger.log(`[dry-run] ensure directory ${path.join(home, "Library", "LaunchAgents")}`);
  logger.log(`[dry-run] ensure directory ${path.join(home, "Library", "Logs")}`);
  logger.log(`[dry-run] ensure directory ${path.join(home, ".local", "bin")}`);
  logger.log(`[dry-run] ensure minimal zsh config ${path.join(home, ".zshrc")} (PATH: ~/.volta/bin, ~/.local/bin)`);
  logger.log(`[dry-run] install launcher ${path.join(home, ".local", "bin", "mac-bootstrap")} -> ${path.join(repoRoot(), "bin", "mac-bootstrap")}`);
  logger.log(`[dry-run] check ${formatCommand("xcode-select", ["-p"])}`);
  logger.log(`[dry-run] install Xcode CLI tools if missing`);
  logger.log(`[dry-run] install Homebrew at ${manifest.homebrewPrefix} if missing`);
  for (const formula of manifest.formulae) {
    logger.log(`[dry-run] brew install ${formula.name} if missing`);
  }
  for (const cask of manifest.casks) {
    logger.log(`[dry-run] brew install --cask ${cask.name} if missing`);
  }
  if (profiles && profiles.includes("node")) {
    logger.log(`[dry-run] volta install node@${manifest.defaultNode}`);
    logger.log(`[dry-run] volta install corepack`);
    logger.log(`[dry-run] corepack enable (per-project pnpm/yarn via packageManager field)`);
  }
  if (profiles && profiles.includes("python")) {
    logger.log(`[dry-run] uv python install ${manifest.defaultPython} (uv owns interpreters; per-project pins via uv)`);
  }
}

function ensureDirectories(home, logger) {
  for (const directory of [
    path.join(home, "Library", "LaunchAgents"),
    path.join(home, "Library", "Logs"),
    path.join(home, ".config"),
    path.join(home, ".local", "bin"),
    path.join(home, ".mac-bootstrap")
  ]) {
    fs.mkdirSync(directory, { recursive: true });
    logger.log(`Ensured directory ${directory}`);
  }
}

// $HOME/.local/bin is the conventional home for user-managed CLI launchers but
// is not on PATH by default on macOS. Add it just behind Volta: each line
// prepends, so the resulting order is ~/.volta/bin, then ~/.local/bin, then the
// rest — Volta keeps runtime priority while user launchers still resolve.
const LOCAL_BIN_LINE = "export PATH=\"$HOME/.local/bin:$PATH\"";
const VOLTA_HOME_LINE = "export VOLTA_HOME=\"$HOME/.volta\"";
const BASELINE_MARKER = "# mac-bootstrap managed baseline";
const BASELINE_END = "# end mac-bootstrap managed baseline";

function ensureZshrc(home, logger) {
  const zshrc = path.join(home, ".zshrc");
  const block = [
    "",
    BASELINE_MARKER,
    "export HOMEBREW_PREFIX=\"/opt/homebrew\"",
    "if [ -x \"$HOMEBREW_PREFIX/bin/brew\" ]; then",
    "  eval \"$($HOMEBREW_PREFIX/bin/brew shellenv)\"",
    "fi",
    LOCAL_BIN_LINE,
    VOLTA_HOME_LINE,
    "export PATH=\"$VOLTA_HOME/bin:$PATH\"",
    BASELINE_END,
    ""
  ].join("\n");

  if (!fs.existsSync(zshrc)) {
    fs.writeFileSync(zshrc, block, { mode: 0o644 });
    logger.log(`Created ${zshrc}`);
    return;
  }

  const existing = fs.readFileSync(zshrc, "utf8");
  if (!existing.includes(BASELINE_MARKER)) {
    fs.appendFileSync(zshrc, block);
    logger.log(`Appended mac-bootstrap shell baseline to ${zshrc}`);
    return;
  }
  if (!existing.includes(LOCAL_BIN_LINE)) {
    // Upgrade an older managed block in place so already-bootstrapped machines
    // also get ~/.local/bin on PATH. Insert ahead of Volta when present, else
    // before the end marker. Guarded by the includes check above, so re-runs do
    // not duplicate the line.
    const updated = existing.includes(VOLTA_HOME_LINE)
      ? existing.replace(VOLTA_HOME_LINE, `${LOCAL_BIN_LINE}\n${VOLTA_HOME_LINE}`)
      : existing.replace(BASELINE_END, `${LOCAL_BIN_LINE}\n${BASELINE_END}`);
    fs.writeFileSync(zshrc, updated);
    logger.log(`Added ~/.local/bin to the mac-bootstrap shell baseline in ${zshrc}`);
    return;
  }
  logger.log(`${zshrc} already contains mac-bootstrap shell baseline`);
}

// Self-register: drop an executable launcher at ~/.local/bin/mac-bootstrap so the
// command resolves from anywhere after the first bootstrap. ensureDirectories has
// created the dir and ensureZshrc has put it on PATH (behind ~/.volta/bin). The
// launcher execs the repo's POSIX entrypoint by absolute path, so editing the
// repo is reflected immediately with no reinstall. Mirrors the ~/.local/bin
// launcher pattern the sibling CLIs use for `install:global`.
function ensureSelfLauncher(home, logger) {
  const launcher = path.join(home, ".local", "bin", "mac-bootstrap");
  const target = path.join(repoRoot(), "bin", "mac-bootstrap");
  const script = `#!/usr/bin/env bash\nexec ${JSON.stringify(target)} "$@"\n`;
  try {
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, script, { mode: 0o755 });
    fs.chmodSync(launcher, 0o755);
    logger.log(`Installed mac-bootstrap launcher at ${launcher}`);
    return { ok: true };
  } catch (error) {
    logger.error(`Failed to install mac-bootstrap launcher: ${error.message}`);
    return { ok: false };
  }
}

function ensureXcodeCli(runner, logger) {
  const check = runner.run("xcode-select", ["-p"]);
  if (check.status === 0) {
    logger.log("Xcode CLI tools already installed.");
    return { ok: true };
  }

  const install = runner.run("xcode-select", ["--install"]);
  if (install.status !== 0) {
    logger.error(`Failed to start Xcode CLI tools install: ${install.stderr}`);
    return { ok: false };
  }
  logger.log("Started Xcode CLI tools install.");
  return { ok: true };
}

function ensureHomebrew(runner, manifest, logger) {
  const brew = brewPath(manifest);
  if (fs.existsSync(brew)) {
    logger.log(`Homebrew already present at ${brew}.`);
    return { ok: true };
  }

  const command = "/bin/bash";
  const args = [
    "-c",
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ];
  const install = runner.run(command, args);
  if (install.status !== 0) {
    logger.error(`Failed to install Homebrew: ${install.stderr}`);
    return { ok: false };
  }
  logger.log("Installed Homebrew.");
  return { ok: true };
}

export function ensureFormula(runner, manifest, name, logger = console) {
  const brew = brewPath(manifest);
  const check = runner.run(brew, ["list", "--formula", name]);
  if (check.status === 0) {
    logger.log(`Formula already installed: ${name}`);
    return { ok: true, changed: false };
  }

  const install = runner.run(brew, ["install", name]);
  if (install.status !== 0) {
    logger.error(`Formula install failed for ${name}: ${install.stderr}`);
    return { ok: false, changed: false };
  }
  logger.log(`Installed formula: ${name}`);
  return { ok: true, changed: true };
}

export function ensureCask(runner, manifest, name, logger = console) {
  const brew = brewPath(manifest);
  const check = runner.run(brew, ["list", "--cask", name]);
  if (check.status === 0) {
    logger.log(`Cask already installed: ${name}`);
    return { ok: true, changed: false };
  }

  const install = runner.run(brew, ["install", "--cask", name]);
  if (install.status !== 0) {
    logger.error(`Cask install failed for ${name}: ${install.stderr}`);
    return { ok: false, changed: false };
  }
  logger.log(`Installed cask: ${name}`);
  return { ok: true, changed: true };
}

function ensureVoltaNode(runner, manifest, logger) {
  const result = runner.run("volta", ["install", `node@${manifest.defaultNode}`]);
  if (result.status !== 0) {
    logger.error(`Failed to install Node via Volta: ${result.stderr}`);
    return { ok: false };
  }
  logger.log(`Ensured Node ${manifest.defaultNode} via Volta.`);
  return { ok: true };
}

// Corepack provisions the exact pnpm/yarn version each project pins in its
// package.json "packageManager" field. Volta only exposes tools on PATH that
// were installed with `volta install`, so we install corepack through Volta to
// get a `~/.volta/bin/corepack` shim, then enable it. Skipping the install step
// leaves `corepack enable` running from the Node image bin dir Volta never puts
// on PATH, so neither corepack nor pnpm becomes callable and `doctor` fails.
function ensureCorepack(runner, home, logger) {
  const installed = runner.run("volta", ["install", "corepack"]);
  if (installed.status !== 0) {
    logger.error(`Failed to install Corepack via Volta: ${installed.stderr}`);
    return { ok: false };
  }
  // On the very first bootstrap run the freshly-written ~/.zshrc has not been
  // sourced, so ~/.volta/bin is not on the live PATH and a bare `corepack enable`
  // dies with ENOENT. Call the Volta shim by absolute path and prepend its dir to
  // PATH for the spawn; fall back to bare `corepack` only when the shim is absent
  // (older Volta layouts), preserving the previous behaviour there.
  const voltaBin = path.join(home, ".volta", "bin");
  const shim = path.join(voltaBin, "corepack");
  const command = fs.existsSync(shim) ? shim : "corepack";
  const enabled = runner.run(command, ["enable"], {
    env: { PATH: `${voltaBin}${path.delimiter}${process.env.PATH ?? ""}` }
  });
  if (enabled.status !== 0) {
    logger.error(`Failed to enable Corepack: ${enabled.stderr}`);
    return { ok: false };
  }
  logger.log("Installed Corepack via Volta and enabled per-project pnpm/yarn (packageManager field).");
  return { ok: true };
}

// uv owns Python interpreters (replacing brew python / pyenv). Seed a baseline
// interpreter; projects pin their own with `uv python pin` / requires-python.
function ensureUvPython(runner, manifest, logger) {
  const result = runner.run("uv", ["python", "install", manifest.defaultPython]);
  if (result.status !== 0) {
    logger.error(`Failed to install Python via uv: ${result.stderr}`);
    return { ok: false };
  }
  logger.log(`Ensured Python ${manifest.defaultPython} via uv.`);
  return { ok: true };
}
