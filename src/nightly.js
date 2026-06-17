import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { brewPath, filterByProfiles, loadManifest } from "./manifest.js";
import { checkNetwork } from "./network.js";
import { FileLogger } from "./logger.js";
import { defaultProfiles, loadSelections } from "./selections.js";
import { caskQuarantine } from "./security/index.js";

export async function nightly({
  dryRun = false,
  home = os.homedir(),
  manifestPath,
  runner,
  logger = console,
  env = process.env,
  networkCheck = checkNetwork,
  postDiscord = postDiscordSummary
}) {
  const fullManifest = loadManifest(manifestPath);
  const saved = loadSelections(home);
  const enabled = saved ? saved.profiles : defaultProfiles(fullManifest);
  const manifest = filterByProfiles(fullManifest, enabled);
  const logPath = path.join(home, "Library", "Logs", "mac-bootstrap-nightly.log");

  if (dryRun) {
    printNightlyPlan({ home, manifest, profiles: enabled, logger });
    return 0;
  }

  if (!(await networkCheck())) {
    logger.error("Network unavailable; nightly upkeep skipped.");
    return 2;
  }

  rotateLogs(logPath, 7);
  const fileLogger = new FileLogger(logPath);
  const log = teeLogger(logger, fileLogger);
  log.log("Starting nightly upkeep.");

  const before = captureVersions(runner, manifest);
  const failures = [];
  runStep(runner, log, failures, brewPath(manifest), ["update"], "brew update");
  runStep(runner, log, failures, brewPath(manifest), ["upgrade"], "brew upgrade");
  runStep(runner, log, failures, brewPath(manifest), ["upgrade", "--cask"], "brew upgrade --cask");
  await runCaskQuarantineSweep({ runner, log, failures, manifest });

  for (const cask of manifest.casks) {
    if (Array.isArray(cask.selfUpdate) && cask.selfUpdate.length > 0) {
      runStep(runner, log, failures, cask.selfUpdate[0], cask.selfUpdate.slice(1), cask.selfUpdate.join(" "));
    }
  }

  for (const npmGlobal of manifest.npmGlobals) {
    runStep(runner, log, failures, "npm", ["install", "--global", npmGlobal], `npm install --global ${npmGlobal}`);
  }

  const after = captureVersions(runner, manifest);
  const summary = buildSummary({ before, after, failures });
  log.log(summary);

  if (env.DISCORD_WEBHOOK_URL) {
    await postDiscord(env.DISCORD_WEBHOOK_URL, summary);
    log.log("Posted Discord nightly summary.");
  }

  return failures.length === 0 ? 0 : 1;
}

export function printNightlyPlan({ home, manifest, profiles, logger }) {
  logger.log("[dry-run] nightly plan");
  logger.log(`[dry-run] enabled profiles: ${profiles && profiles.length > 0 ? profiles.join(", ") : "(none)"}`);
  logger.log(`[dry-run] rotate ${path.join(home, "Library", "Logs", "mac-bootstrap-nightly.log")} with 7-day retention`);
  logger.log("[dry-run] capture before versions");
  logger.log("[dry-run] brew update");
  logger.log("[dry-run] brew upgrade");
  logger.log("[dry-run] brew upgrade --cask");
  logger.log("[dry-run] strip quarantine from nested Homebrew Cask helper binaries");
  for (const cask of manifest.casks) {
    if (Array.isArray(cask.selfUpdate) && cask.selfUpdate.length > 0) {
      logger.log(`[dry-run] ${cask.selfUpdate.join(" ")}`);
    }
  }
  if (manifest.npmGlobals.length === 0) {
    logger.log("[dry-run] no npm-global packages pinned");
  }
  for (const npmGlobal of manifest.npmGlobals) {
    logger.log(`[dry-run] npm install --global ${npmGlobal}`);
  }
  logger.log("[dry-run] capture after versions");
  logger.log("[dry-run] post Discord summary only if DISCORD_WEBHOOK_URL is set");
}

export function rotateLogs(logPath, retentionDays) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (fs.existsSync(logPath) && fs.statSync(logPath).size > 0) {
    const stamp = new Date().toISOString().replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
    fs.renameSync(logPath, `${logPath}.${stamp}`);
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(path.dirname(logPath))) {
    if (!entry.startsWith(`${path.basename(logPath)}.`)) {
      continue;
    }
    const fullPath = path.join(path.dirname(logPath), entry);
    if (fs.statSync(fullPath).mtimeMs < cutoff) {
      fs.rmSync(fullPath);
    }
  }
}

export function captureVersions(runner, manifest) {
  const commands = [
    ["brew formulae", brewPath(manifest), ["list", "--versions"]],
    ["brew casks", brewPath(manifest), ["list", "--cask", "--versions"]],
    ["volta", "volta", ["--version"]],
    ["node", "node", ["--version"]],
    ["npm", "npm", ["--version"]]
  ];

  for (const cask of manifest.casks) {
    if (cask.command) {
      commands.push([cask.command, cask.command, ["--version"]]);
    }
  }

  const versions = {};
  for (const [name, command, args] of commands) {
    const result = runner.run(command, args);
    versions[name] = result.status === 0 ? result.stdout.trim() : `unavailable: ${(result.stderr || result.status).toString().trim()}`;
  }
  return versions;
}

export function buildSummary({ before, after, failures }) {
  const changes = [];
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      changes.push(`${key}: ${before[key] || "<empty>"} => ${after[key] || "<empty>"}`);
    }
  }

  const lines = ["mac-bootstrap nightly summary"];
  lines.push(`status: ${failures.length === 0 ? "ok" : "failed"}`);
  lines.push(`changes: ${changes.length === 0 ? "none" : changes.join("; ")}`);
  if (failures.length > 0) {
    lines.push(`failures: ${failures.join("; ")}`);
  }
  return lines.join("\n");
}

function runStep(runner, logger, failures, command, args, label) {
  const result = runner.run(command, args);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    failures.push(`${label}: ${detail}`);
    logger.error(`${label} failed: ${detail}`);
    return;
  }
  logger.log(`${label} complete.`);
}

async function runCaskQuarantineSweep({ runner, log, failures, manifest }) {
  const result = await caskQuarantine.apply({
    runner,
    logger: log,
    homebrewPrefix: runner.homebrewPrefix || manifest.homebrewPrefix,
    caskNames: manifest.casks.map((cask) => cask.name)
  });
  if (result.error) {
    failures.push(`cask quarantine sweep: ${result.error}`);
    log.error(`cask quarantine sweep failed: ${result.error}`);
  }
}

function teeLogger(first, second) {
  return {
    log(message) {
      first.log(message);
      second.log(message);
    },
    error(message) {
      first.error(message);
      second.error(message);
    }
  };
}

async function postDiscordSummary(webhookUrl, summary) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: summary.slice(0, 1900) })
  });
  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status}`);
  }
}
