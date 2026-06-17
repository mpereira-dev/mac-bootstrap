import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { brewPath, filterByProfiles, loadManifest, repoRoot } from "./manifest.js";
import { defaultProfiles, loadSelections } from "./selections.js";
import { caskQuarantine } from "./security/index.js";

const CHECK_TIMEOUT_MS = 15000;

export async function doctor({
  dryRun = false,
  home = os.homedir(),
  manifestPath,
  runner,
  logger = console
}) {
  const fullManifest = loadManifest(manifestPath);
  const saved = loadSelections(home);
  const enabled = saved ? saved.profiles : defaultProfiles(fullManifest);
  const manifest = filterByProfiles(fullManifest, enabled);

  if (dryRun) {
    printDoctorPlan({ home, manifest, profiles: enabled, logger });
    return 0;
  }

  const failures = [];
  const emitCheck = (check) => {
    const message = `${check.ok ? "ok" : "fail"} - ${check.name}${check.detail ? ` (${check.detail})` : ""}`;
    if (check.ok) {
      logger.log(message);
    } else {
      logger.warn(message);
      failures.push(check);
    }
    return check;
  };

  emitCheck(checkDirectory(path.join(home, "Library", "LaunchAgents")));
  emitCheck(checkDirectory(path.join(home, "Library", "Logs")));
  emitCheck(checkFile(path.join(repoRoot(), "launchd", "com.mac-bootstrap.nightly.plist"), "launchd template"));
  emitCheck(checkLaunchdState(home, runner));
  emitCheck(checkZshrc(path.join(home, ".zshrc")));
  emitCheck(checkCommand(runner, "xcode-select", ["-p"], "Xcode CLI tools"));

  for (const formula of manifest.formulae) {
    emitCheck(checkCommand(runner, brewPath(manifest), ["list", "--formula", "--versions", formula.name], `formula ${formula.name}`));
  }
  for (const cask of manifest.casks) {
    if (cask.command) {
      emitCheck(checkCommand(runner, cask.command, ["--version"], `command ${cask.command}`));
    } else {
      emitCheck(checkCommand(runner, brewPath(manifest), ["list", "--cask", "--versions", cask.name], `cask ${cask.name}`));
    }
  }
  emitCheck(await checkCaskQuarantine(runner, manifest.casks));
  if (enabled.includes("node")) {
    emitCheck(checkCommand(runner, "volta", ["which", "node"], "Volta Node"));
    emitCheck(checkCommand(runner, "node", ["--version"], "Node runtime", (stdout) => stdout.includes(`v${manifest.defaultNode}.`)));
    emitCheck(checkCommand(runner, "corepack", ["--version"], "Corepack"));
  }
  if (enabled.includes("python")) {
    emitCheck(checkCommand(runner, "uv", ["--version"], "uv"));
    emitCheck(checkCommand(runner, "poetry", ["--version"], "Poetry"));
  }
  if (saved) {
    logger.log(`enabled profiles: ${enabled.join(", ")}`);
  } else {
    logger.log(`enabled profiles (defaults; no saved selection): ${enabled.join(", ")}`);
  }

  if (failures.length > 0) {
    logger.error(`${failures.length} doctor check(s) failed.`);
    return 1;
  }
  return 0;
}

export function printDoctorPlan({ home, manifest, profiles, logger }) {
  logger.log("[dry-run] doctor plan");
  logger.log(`[dry-run] enabled profiles: ${profiles && profiles.length > 0 ? profiles.join(", ") : "(none)"}`);
  logger.log(`[dry-run] check directory ${path.join(home, "Library", "LaunchAgents")}`);
  logger.log(`[dry-run] check directory ${path.join(home, "Library", "Logs")}`);
  logger.log(`[dry-run] check launchd template`);
  logger.log(`[dry-run] check launchd job if plist has been installed`);
  logger.log(`[dry-run] check zsh baseline ${path.join(home, ".zshrc")}`);
  logger.log(`[dry-run] check Xcode CLI tools`);
  for (const formula of manifest.formulae) {
    logger.log(`[dry-run] check formula ${formula.name}`);
  }
  for (const cask of manifest.casks) {
    if (cask.command) {
      logger.log(`[dry-run] check command ${cask.command} from cask ${cask.name}`);
    } else {
      logger.log(`[dry-run] check cask ${cask.name}`);
    }
  }
  logger.log("[dry-run] check Homebrew Cask nested helper quarantine");
  if (profiles && profiles.includes("node")) {
    logger.log(`[dry-run] check node v${manifest.defaultNode}`);
    logger.log(`[dry-run] check corepack`);
  }
  if (profiles && profiles.includes("python")) {
    logger.log(`[dry-run] check uv + poetry`);
  }
}

function checkDirectory(directory) {
  return {
    name: `directory ${directory}`,
    ok: fs.existsSync(directory) && fs.statSync(directory).isDirectory()
  };
}

function checkFile(filePath, name) {
  return {
    name,
    ok: fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  };
}

function checkLaunchdState(home, runner) {
  const installedPlist = path.join(home, "Library", "LaunchAgents", "com.mac-bootstrap.nightly.plist");
  if (!fs.existsSync(installedPlist)) {
    return {
      name: "launchd nightly job",
      ok: true,
      detail: "plist not installed; template-only mode"
    };
  }
  return checkCommand(runner, "launchctl", ["print", `gui/${process.getuid()}/com.mac-bootstrap.nightly`], "launchd nightly job");
}

function checkZshrc(zshrc) {
  const ok = fs.existsSync(zshrc) && fs.readFileSync(zshrc, "utf8").includes("# mac-bootstrap managed baseline");
  return { name: `zsh baseline ${zshrc}`, ok };
}

function checkCommand(runner, command, args, name, validate = () => true) {
  const result = runner.run(command, args, { timeoutMs: CHECK_TIMEOUT_MS });
  const ok = result.status === 0 && validate(result.stdout ?? "");
  return {
    name,
    ok,
    detail: ok ? undefined : (result.stderr || result.stdout || `exit ${result.status}`).trim()
  };
}

async function checkCaskQuarantine(runner, casks) {
  const current = await caskQuarantine.detect({
    runner,
    caskNames: casks.map((cask) => cask.name)
  });
  return {
    name: "Homebrew Cask nested helper quarantine",
    ok: current.ok,
    detail: current.ok
      ? current.detail
      : `${current.quarantined?.length || 0} quarantined; run ./bin/security --apply --skip filevault --skip firewall --skip ssh-hardening`
  };
}
