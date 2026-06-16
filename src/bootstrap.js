import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatCommand } from "./command-runner.js";
import { brewPath, filterByProfiles, loadManifest } from "./manifest.js";
import { checkNetwork } from "./network.js";
import { pickProfiles, pickProfilesInteractive } from "./prompt.js";
import { defaultProfiles, loadSelections, profileNamesToShow, saveSelections } from "./selections.js";

export async function bootstrap({
  dryRun = false,
  yes = false,
  reconfigure = false,
  allProfiles = false,
  profiles: profilesOverride,
  home = os.homedir(),
  manifestPath,
  runner,
  logger = console,
  networkCheck = checkNetwork,
  prompt,
  interactive = Boolean(process.stdin && process.stdin.isTTY)
}) {
  const fullManifest = loadManifest(manifestPath);
  const saved = loadSelections(home);
  const defaults = defaultProfiles(fullManifest);

  const selectedProfiles = await resolveProfileSelection({
    fullManifest,
    saved,
    defaults,
    profilesOverride,
    yes,
    reconfigure,
    allProfiles,
    home,
    logger,
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
    if (!ensureCorepack(runner, logger).ok) {
      failures.push("corepack");
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
  profilesOverride,
  yes,
  reconfigure,
  allProfiles,
  home,
  logger,
  prompt,
  interactive
}) {
  if (Array.isArray(profilesOverride) && profilesOverride.length > 0) {
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
  // when tests inject a `prompt` function or when stdin is not a TTY. Hidden
  // profiles (ai/mobile/network) are off the menu unless --all-profiles is set,
  // but any already-enabled hidden profile stays visible so it is never dropped.
  const promptDefaults = saved ? saved.profiles : defaults;
  const names = profileNamesToShow(fullManifest, { all: allProfiles, include: promptDefaults });
  let picked;
  if (typeof prompt === "function" || !interactive) {
    picked = await pickProfiles({ manifest: fullManifest, logger, defaults: promptDefaults, names, prompt });
  } else {
    picked = await pickProfilesInteractive({ manifest: fullManifest, defaults: promptDefaults, names });
  }
  const file = saveSelections(home, picked);
  logger.log(`Saved profile selection to ${file}`);
  return picked;
}

export function printBootstrapPlan({ home, manifest, profiles, logger }) {
  logger.log("[dry-run] bootstrap plan");
  logger.log(`[dry-run] enabled profiles: ${profiles && profiles.length > 0 ? profiles.join(", ") : "(none)"}`);
  logger.log(`[dry-run] ensure directory ${path.join(home, "Library", "LaunchAgents")}`);
  logger.log(`[dry-run] ensure directory ${path.join(home, "Library", "Logs")}`);
  logger.log(`[dry-run] ensure minimal zsh config ${path.join(home, ".zshrc")}`);
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
    logger.log(`[dry-run] corepack enable (per-project pnpm/yarn via packageManager field)`);
  }
}

function ensureDirectories(home, logger) {
  for (const directory of [
    path.join(home, "Library", "LaunchAgents"),
    path.join(home, "Library", "Logs"),
    path.join(home, ".config"),
    path.join(home, ".mac-bootstrap")
  ]) {
    fs.mkdirSync(directory, { recursive: true });
    logger.log(`Ensured directory ${directory}`);
  }
}

function ensureZshrc(home, logger) {
  const zshrc = path.join(home, ".zshrc");
  const block = [
    "",
    "# mac-bootstrap managed baseline",
    "export HOMEBREW_PREFIX=\"/opt/homebrew\"",
    "if [ -x \"$HOMEBREW_PREFIX/bin/brew\" ]; then",
    "  eval \"$($HOMEBREW_PREFIX/bin/brew shellenv)\"",
    "fi",
    "export VOLTA_HOME=\"$HOME/.volta\"",
    "export PATH=\"$VOLTA_HOME/bin:$PATH\"",
    "# end mac-bootstrap managed baseline",
    ""
  ].join("\n");

  if (!fs.existsSync(zshrc)) {
    fs.writeFileSync(zshrc, block, { mode: 0o644 });
    logger.log(`Created ${zshrc}`);
    return;
  }

  const existing = fs.readFileSync(zshrc, "utf8");
  if (!existing.includes("# mac-bootstrap managed baseline")) {
    fs.appendFileSync(zshrc, block);
    logger.log(`Appended mac-bootstrap shell baseline to ${zshrc}`);
  } else {
    logger.log(`${zshrc} already contains mac-bootstrap shell baseline`);
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

// Corepack ships with Node and provisions the exact pnpm/yarn version each
// project pins in its package.json "packageManager" field. mac-bootstrap only
// turns it on; per-project versions live in the projects, not on the machine.
function ensureCorepack(runner, logger) {
  const result = runner.run("corepack", ["enable"]);
  if (result.status !== 0) {
    logger.error(`Failed to enable Corepack: ${result.stderr}`);
    return { ok: false };
  }
  logger.log("Enabled Corepack (per-project pnpm/yarn via packageManager field).");
  return { ok: true };
}
