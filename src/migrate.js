import os from "node:os";
import path from "node:path";
import { formatCommand } from "./command-runner.js";
import { brewPath, loadManifest, repoRoot } from "./manifest.js";

// Returns the bin leaf of a possibly-tap-qualified formula name
// ("hashicorp/tap/terraform" -> "terraform").
function leaf(name) {
  const parts = String(name).split("/");
  return parts[parts.length - 1];
}

// What mac-bootstrap would run to install this tool the managed way, or null
// when the manifest has no opinion (the tool should not have been MIGRATE then).
export function resolveManagedInstall(record, manifest) {
  if (record.name === "node") {
    return { command: "volta", args: ["install", `node@${manifest.defaultNode}`] };
  }
  const brew = brewPath(manifest);
  const formula = (manifest.formulae || []).find(
    (entry) => entry.command === record.name || leaf(entry.name) === record.name
  );
  if (formula) {
    return { command: brew, args: ["install", formula.name] };
  }
  const cask = (manifest.casks || []).find(
    (entry) => entry.command === record.name || leaf(entry.name) === record.name
  );
  if (cask) {
    return { command: brew, args: ["install", "--cask", cask.name] };
  }
  return null;
}

// A provenance `remove` string is safe to run automatically only when it has no
// placeholder (`<version>`) and no comment (`#`). Everything else needs a human.
export function parseRemovable(remove) {
  if (!remove || remove.includes("<") || remove.includes("#")) {
    return { runnable: false };
  }
  const parts = remove.trim().split(/\s+/);
  return { runnable: true, command: parts[0], args: parts.slice(1) };
}

export function buildPlan(record, manifest) {
  const install = resolveManagedInstall(record, manifest);
  const remove = parseRemovable(record.remove);
  return {
    name: record.name,
    manager: record.manager,
    install,
    remove: remove.runnable ? remove : null,
    removable: remove.runnable,
    removeDisplay: record.remove
  };
}

// Default provenance reader: run tools/provenance.sh --json through the runner.
async function defaultReadProvenance({ runner, manifestPath, tools }) {
  const script = path.join(repoRoot(), "tools", "provenance.sh");
  const args = [script, "--json"];
  if (manifestPath) {
    args.push("--packages", manifestPath);
  }
  for (const tool of tools || []) {
    args.push(tool);
  }
  const result = runner.run("bash", args);
  if (result.status !== 0) {
    throw new Error(`provenance audit failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`could not parse provenance output: ${error.message}`);
  }
}

export async function migrate({
  apply = false,
  tools,
  home = os.homedir(),
  manifestPath,
  runner,
  logger = console,
  readProvenance = defaultReadProvenance
}) {
  const manifest = loadManifest(manifestPath);
  const records = await readProvenance({ runner, manifestPath, tools, home });
  const toMigrate = records.filter((record) => record.verdict === "MIGRATE");

  if (toMigrate.length === 0) {
    logger.log("Nothing to migrate. Audited tools are managed correctly or unmanaged.");
    return 0;
  }

  const plans = toMigrate.map((record) => buildPlan(record, manifest));

  logger.log(`Found ${plans.length} tool(s) installed the old way:`);
  for (const plan of plans) {
    logger.log("");
    logger.log(`• ${plan.name} (currently: ${plan.manager})`);
    logger.log(
      `    install managed : ${plan.install ? formatCommand(plan.install.command, plan.install.args) : "(no managed install resolved — check packages.json)"}`
    );
    logger.log(`    remove old      : ${plan.removable ? plan.removeDisplay : `MANUAL — ${plan.removeDisplay}`}`);
  }

  if (!apply) {
    logger.log("");
    logger.log("Plan only. Re-run with --apply to install the managed versions and remove the old ones.");
    return 0;
  }

  const failures = [];
  for (const plan of plans) {
    logger.log("");
    logger.log(`Migrating ${plan.name}...`);

    if (!plan.install) {
      logger.error(`  no managed install resolved for ${plan.name}; skipping.`);
      failures.push(`${plan.name}: no managed install`);
      continue;
    }

    const installed = runner.run(plan.install.command, plan.install.args);
    if (installed.status !== 0) {
      logger.error(`  managed install failed: ${(installed.stderr || installed.stdout || `exit ${installed.status}`).trim()}`);
      failures.push(`${plan.name}: install failed`);
      continue; // never remove the old copy if the replacement did not land
    }
    logger.log(`  installed managed ${plan.name}.`);

    if (!plan.removable) {
      logger.log(`  manual removal needed: ${plan.removeDisplay}`);
      continue;
    }

    const removed = runner.run(plan.remove.command, plan.remove.args);
    if (removed.status !== 0) {
      logger.error(`  removal failed: ${(removed.stderr || removed.stdout || `exit ${removed.status}`).trim()}`);
      failures.push(`${plan.name}: removal failed`);
      continue;
    }
    logger.log(`  removed old ${plan.name}.`);
  }

  if (failures.length > 0) {
    logger.error(`Migrate completed with failures: ${failures.join(", ")}`);
    return 1;
  }
  logger.log("Migrate complete.");
  return 0;
}
