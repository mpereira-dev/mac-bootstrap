import fs from "node:fs";
import path from "node:path";
import { loadManifest } from "../manifest.js";

export const name = "cask-quarantine";

const XATTR = "/usr/bin/xattr";
const QUARANTINE_ATTR = "com.apple.quarantine";
const HELPER_NAMES = new Set(["rg"]);

export async function detect({ runner, homebrewPrefix, caskNames } = {}) {
  if (!runner) throw new Error("cask-quarantine.detect: runner is required");
  const helpers = findNestedHelpers({ homebrewPrefix: resolveHomebrewPrefix({ runner, homebrewPrefix }), caskNames });
  const quarantined = [];
  const queryFailures = [];

  for (const helper of helpers) {
    const result = await runner.run(XATTR, ["-p", QUARANTINE_ATTR, helper.path]);
    const status = result.exitCode ?? result.status;
    if (status === 0) {
      quarantined.push({ ...helper, attribute: (result.stdout || "").trim() });
      continue;
    }
    const detail = `${result.stderr || result.stdout || ""}`.trim();
    if (detail && !/No such xattr|No such file/i.test(detail)) {
      queryFailures.push({ ...helper, error: detail });
    }
  }

  if (queryFailures.length > 0) {
    return {
      ok: false,
      helpers,
      quarantined,
      queryFailures,
      error: "xattr query failed for one or more Homebrew Cask helper binaries"
    };
  }

  return {
    ok: quarantined.length === 0,
    helpers,
    quarantined,
    detail: `${quarantined.length}/${helpers.length} helper binaries quarantined`
  };
}

export async function suggest({ current } = {}) {
  if (!current) return { advice: "cannot determine Homebrew Cask helper quarantine state" };
  if (current.queryFailures?.length > 0) {
    return {
      advice: "cannot inspect quarantine xattrs for some Homebrew Cask helper binaries",
      notes: current.queryFailures.map((helper) => `${helper.path}: ${helper.error}`)
    };
  }
  if (!current.quarantined || current.quarantined.length === 0) {
    return { advice: "Homebrew Cask nested helper binaries are not quarantined — no action" };
  }
  return {
    advice: `${current.quarantined.length} Homebrew Cask nested helper binary${current.quarantined.length === 1 ? " is" : "ies are"} quarantined — strip the quarantine xattr`,
    commands: current.quarantined.map((helper) => `/usr/bin/xattr -d ${QUARANTINE_ATTR} ${helper.path}`),
    notes: [
      "Targets only helper binaries inside Homebrew's Caskroom, not Downloads or /Applications broadly",
      "This fixes Codex's bundled rg Gatekeeper prompt and can recur after cask upgrades",
      "Homebrew Cask verifies downloaded artifacts before extraction; this is not a system-wide Gatekeeper disable"
    ]
  };
}

export async function apply({ runner, logger = console, dryRun = false, homebrewPrefix, caskNames } = {}) {
  if (!runner) throw new Error("cask-quarantine.apply: runner is required");
  const resolvedPrefix = resolveHomebrewPrefix({ runner, homebrewPrefix });
  const before = await detect({ runner, homebrewPrefix: resolvedPrefix, caskNames });
  if (!before.ok && before.queryFailures?.length > 0) {
    logger.log(`cask-quarantine: cannot inspect helpers — ${before.error}`);
    return { changed: false, error: before.error };
  }
  if (before.quarantined.length === 0) {
    logger.log("cask-quarantine: no quarantined Homebrew Cask helper binaries — noop");
    return { changed: false };
  }

  if (dryRun) {
    for (const helper of before.quarantined) {
      logger.log(`cask-quarantine: DRY RUN — would run ${XATTR} -d ${QUARANTINE_ATTR} ${helper.path}`);
    }
    return { changed: false, dryRun: true, targets: before.quarantined.map((helper) => helper.path) };
  }

  const errors = [];
  for (const helper of before.quarantined) {
    logger.log(`cask-quarantine: ${XATTR} -d ${QUARANTINE_ATTR} ${helper.path}`);
    const result = await runner.run(XATTR, ["-d", QUARANTINE_ATTR, helper.path]);
    const status = result.exitCode ?? result.status;
    const detail = `${result.stderr || result.stdout || ""}`.trim();
    if (status !== 0 && !/No such xattr|No such file/i.test(detail)) {
      errors.push(`${helper.path}: ${detail || `exit ${status}`}`);
    }
  }

  if (errors.length > 0) {
    return { changed: false, error: errors.join("; ") };
  }
  const after = await detect({ runner, homebrewPrefix: resolvedPrefix, caskNames });
  return { changed: true, before, after };
}

export function findNestedHelpers({ homebrewPrefix, caskNames } = {}) {
  const caskroom = path.join(homebrewPrefix || loadManifest().homebrewPrefix, "Caskroom");
  if (!fs.existsSync(caskroom)) {
    return [];
  }
  const allowedCasks = Array.isArray(caskNames) && caskNames.length > 0 ? new Set(caskNames) : null;
  const helpers = [];

  for (const caskName of safeReaddir(caskroom).sort()) {
    if (allowedCasks && !allowedCasks.has(caskName)) {
      continue;
    }
    const caskPath = path.join(caskroom, caskName);
    if (!safeStat(caskPath)?.isDirectory()) {
      continue;
    }
    walk(caskPath, (filePath, stat) => {
      if (!stat.isFile() || !HELPER_NAMES.has(path.basename(filePath))) {
        return;
      }
      helpers.push({
        cask: caskName,
        name: path.basename(filePath),
        path: filePath
      });
    });
  }

  return helpers.sort((a, b) => a.path.localeCompare(b.path));
}

function resolveHomebrewPrefix({ runner, homebrewPrefix }) {
  return homebrewPrefix || runner?.homebrewPrefix || loadManifest().homebrewPrefix;
}

function walk(directory, visit) {
  for (const entry of safeReaddir(directory)) {
    const fullPath = path.join(directory, entry);
    const stat = safeStat(fullPath);
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      walk(fullPath, visit);
    } else {
      visit(fullPath, stat);
    }
  }
}

function safeReaddir(directory) {
  try {
    return fs.readdirSync(directory);
  } catch {
    return [];
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
