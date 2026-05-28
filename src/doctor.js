import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { brewPath, loadManifest, repoRoot } from "./manifest.js";

export function doctorHelp() {
  return `Usage: ./bin/doctor [--dry-run] [--home PATH] [--packages PATH]

Verifies the laptop matches the mac-bootstrap expected state.`;
}

export async function doctor({
  dryRun = false,
  home = os.homedir(),
  manifestPath,
  runner,
  logger = console
}) {
  const manifest = loadManifest(manifestPath);
  if (dryRun) {
    printDoctorPlan({ home, manifest, logger });
    return 0;
  }

  const checks = [];
  checks.push(checkDirectory(path.join(home, "Library", "LaunchAgents")));
  checks.push(checkDirectory(path.join(home, "Library", "Logs")));
  checks.push(checkFile(path.join(repoRoot(), "launchd", "com.mac-bootstrap.nightly.plist"), "launchd template"));
  checks.push(checkLaunchdState(home, runner));
  checks.push(checkZshrc(path.join(home, ".zshrc")));
  checks.push(checkCommand(runner, "xcode-select", ["-p"], "Xcode CLI tools"));

  for (const formula of manifest.formulae) {
    checks.push(checkCommand(runner, brewPath(manifest), ["list", "--formula", formula.name], `formula ${formula.name}`));
  }
  for (const cask of manifest.casks) {
    checks.push(checkCommand(runner, brewPath(manifest), ["list", "--cask", cask.name], `cask ${cask.name}`));
    if (cask.command) {
      checks.push(checkCommand(runner, cask.command, ["--version"], `command ${cask.command}`));
    }
  }
  checks.push(checkCommand(runner, "volta", ["which", "node"], "Volta Node"));
  checks.push(checkCommand(runner, "node", ["--version"], "Node runtime", (stdout) => stdout.includes(`v${manifest.defaultNode}.`)));

  const failures = checks.filter((check) => !check.ok);
  for (const check of checks) {
    logger.log(`${check.ok ? "ok" : "fail"} - ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
  }

  return failures.length === 0 ? 0 : 1;
}

export function printDoctorPlan({ home, manifest, logger }) {
  logger.log("[dry-run] doctor plan");
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
    logger.log(`[dry-run] check cask ${cask.name}`);
  }
  logger.log(`[dry-run] check node v${manifest.defaultNode}`);
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
  const result = runner.run(command, args);
  const ok = result.status === 0 && validate(result.stdout ?? "");
  return {
    name,
    ok,
    detail: ok ? undefined : (result.stderr || result.stdout || `exit ${result.status}`).trim()
  };
}
