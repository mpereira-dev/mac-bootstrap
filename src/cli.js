import { pathToFileURL } from "node:url";
import { parseArgs as parseBootstrapArgs } from "./args.js";
import { bootstrap } from "./bootstrap.js";
import { CommandRunner } from "./command-runner.js";
import { doctor } from "./doctor.js";
import { presetLines, printHelp, printPresets, printProfiles } from "./help.js";
import { ConsoleLogger, PlainConsoleLogger } from "./logger.js";
import { loadManifest } from "./manifest.js";
import { migrate } from "./migrate.js";
import { nightly } from "./nightly.js";
import { detectAll, MODULES } from "./security/index.js";

const COMMANDS = new Set(["bootstrap", "doctor", "nightly", "migrate", "security"]);
// Lightweight read-only listing commands. They share no install machinery with
// COMMANDS, so they route straight to a printer rather than runCommand.
const LIST_COMMANDS = new Set(["presets", "profiles"]);

export async function main(
  argv = process.argv.slice(2),
  { logger = new ConsoleLogger(), helpLogger = new PlainConsoleLogger(), env = process.env } = {}
) {
  try {
    const resolved = resolveCommand(argv);
    if (resolved.mode === "root-help") {
      printRootHelp(helpLogger);
      return 0;
    }
    if (resolved.mode === "unknown") {
      logger.error(`Unknown command: ${resolved.command}`);
      printRootHelp(helpLogger);
      return 1;
    }
    if (resolved.mode === "help") {
      if (!resolved.command) {
        printRootHelp(helpLogger);
        return 0;
      }
      return printHelp(resolved.command, resolved.args, { logger: helpLogger });
    }
    if (resolved.mode === "list") {
      return resolved.command === "presets"
        ? printPresets({ logger: helpLogger })
        : printProfiles({ logger: helpLogger });
    }
    return await runCommand(resolved.command, resolved.args, { logger, helpLogger, env });
  } catch (error) {
    logger.error(error.message);
    return 1;
  }
}

export function resolveCommand(argv) {
  const [first, ...rest] = argv;
  if (first === "--help" || first === "-h") {
    return { mode: "root-help" };
  }
  if (first === "help") {
    const [command, ...topics] = rest;
    if (command && !COMMANDS.has(command)) {
      return { mode: "unknown", command };
    }
    return { mode: "help", command, args: topics };
  }
  if (LIST_COMMANDS.has(first)) {
    return { mode: "list", command: first };
  }
  if (COMMANDS.has(first)) {
    return { mode: "command", command: first, args: rest };
  }
  if (!first || first.startsWith("-")) {
    return { mode: "command", command: "bootstrap", args: argv };
  }
  return { mode: "unknown", command: first };
}

export function printRootHelp(logger = console) {
  logger.log("mac-bootstrap");
  logger.log("Single operator surface for deterministic macOS bootstrap and upkeep.");
  logger.log("");
  logger.log("Usage: mac-bootstrap <command> [args]");
  logger.log("");
  logger.log("Commands:");
  logger.log("  bootstrap  Install the owner-approved baseline");
  logger.log("  doctor     Verify the laptop matches the expected baseline");
  logger.log("  nightly    Run unattended maintenance");
  logger.log("  migrate    Move unmanaged tools onto managed installs");
  logger.log("  security   Detect and apply local security hardening");
  logger.log("  presets    List the preset codenames and what they install");
  logger.log("  profiles   List the package profiles and their defaults");

  // Quick-start teaser: surface the preset codenames up front so a first-time
  // user sees the one-word path without digging into the help tree. Loaded
  // lazily and guarded so a missing/broken manifest never breaks root help.
  let manifest = null;
  try {
    manifest = loadManifest();
  } catch {
    manifest = null;
  }
  const presetNames = manifest ? Object.keys(manifest.presets || {}) : [];
  if (presetNames.length > 0) {
    logger.log("");
    logger.log("Quick start — a preset is one word that expands to a full profile set:");
    for (const line of presetLines(manifest)) {
      logger.log(line);
    }
    logger.log("");
    logger.log(`  mac-bootstrap bootstrap --preset ${presetNames[0]}   install that set, no prompts`);
    logger.log("  mac-bootstrap bootstrap                    first run: pick profiles interactively");
    logger.log("  mac-bootstrap presets                      show this list again");
  }

  logger.log("");
  logger.log("Compatibility:");
  logger.log("  mac-bootstrap --dry-run      same as mac-bootstrap bootstrap --dry-run");
  logger.log("  ./bin/<command>              still works as a command shortcut");
  logger.log("");
  logger.log("More help:");
  logger.log("  mac-bootstrap help <command> [topic...]");
  logger.log("  mac-bootstrap <command> --help [topic...]");
}

async function runCommand(command, argv, { logger, helpLogger, env }) {
  if (command === "bootstrap") {
    const options = parseBootstrapArgs(argv);
    if (options.help) {
      return printHelp("bootstrap", options.helpTopics, { logger: helpLogger });
    }
    return bootstrap({
      ...options,
      runner: new CommandRunner({ dryRun: options.dryRun, logger }),
      logger,
      promptLogger: helpLogger
    });
  }

  if (command === "doctor") {
    const options = parseBootstrapArgs(argv);
    if (options.help) {
      return printHelp("doctor", options.helpTopics, { logger: helpLogger });
    }
    return doctor({
      ...options,
      runner: new CommandRunner({ dryRun: options.dryRun, logger }),
      logger
    });
  }

  if (command === "nightly") {
    const options = parseBootstrapArgs(argv);
    if (options.help) {
      return printHelp("nightly", options.helpTopics, { logger: helpLogger });
    }
    return nightly({
      ...options,
      runner: new CommandRunner({ dryRun: options.dryRun, logger }),
      logger,
      env
    });
  }

  if (command === "migrate") {
    const options = parseMigrateArgs(argv);
    if (options.help) {
      return printHelp("migrate", options.helpTopics, { logger: helpLogger });
    }
    return migrate({
      ...options,
      runner: new CommandRunner(),
      logger
    });
  }

  if (command === "security") {
    const args = parseSecurityArgs(argv);
    if (args.help) {
      return printHelp("security", args.helpTopics, { logger: helpLogger });
    }
    return runSecurity(args, { logger });
  }

  throw new Error(`Unknown command: ${command}`);
}

export function parseMigrateArgs(argv) {
  const options = {
    apply: false,
    home: process.env.HOME,
    manifestPath: undefined,
    tools: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--home") {
      index += 1;
      options.home = requireValue(arg, argv[index]);
    } else if (arg.startsWith("--home=")) {
      options.home = arg.slice("--home=".length);
    } else if (arg === "--packages") {
      index += 1;
      options.manifestPath = requireValue(arg, argv[index]);
    } else if (arg.startsWith("--packages=")) {
      options.manifestPath = arg.slice("--packages=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
      options.helpTopics = argv.slice(index + 1);
      break;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      options.tools.push(arg);
    }
  }

  return options;
}

export function parseSecurityArgs(argv) {
  const out = { apply: false, dryRun: false, skip: new Set(), sshMode: "harden", help: false, helpTopics: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--skip") out.skip.add(requireValue(arg, argv[++index]));
    else if (arg.startsWith("--skip=")) out.skip.add(arg.slice("--skip=".length));
    else if (arg === "--ssh-mode") out.sshMode = requireValue(arg, argv[++index]);
    else if (arg.startsWith("--ssh-mode=")) out.sshMode = arg.slice("--ssh-mode=".length);
    else if (arg === "--help" || arg === "-h") {
      out.help = true;
      out.helpTopics = argv.slice(index + 1);
      break;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!["harden", "disable"].includes(out.sshMode)) {
    throw new Error("--ssh-mode must be harden or disable");
  }
  for (const moduleName of out.skip) {
    if (!MODULES.some((module) => module.name === moduleName)) {
      throw new Error(`Unknown security module: ${moduleName}`);
    }
  }
  return out;
}

function requireValue(flag, value) {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function runSecurity(args, { logger }) {
  const runner = new CommandRunner({ logger });

  logger.log("=== detect ===");
  const states = await detectAll({ runner });
  for (const [name, state] of Object.entries(states)) {
    logger.log(`  ${name}: ${JSON.stringify(state)}`);
  }

  logger.log("\n=== suggest ===");
  for (const module of MODULES) {
    const name = module.name;
    const suggestion = await module.suggest({ current: states[name] });
    logger.log(`  ${name}: ${suggestion.advice}`);
    if (suggestion.command) logger.log(`    cmd: ${suggestion.command}`);
    if (suggestion.commands) for (const command of suggestion.commands) logger.log(`    cmd: ${command}`);
    if (suggestion.options) {
      for (const option of suggestion.options) {
        logger.log(`    option: ${option.label}`);
        if (option.command) logger.log(`      ${option.command}`);
        if (option.commands) for (const command of option.commands) logger.log(`      ${command}`);
      }
    }
    if (suggestion.notes) for (const note of suggestion.notes) logger.log(`    note: ${note}`);
  }

  if (!args.apply) {
    logger.log(args.dryRun
      ? "\n(read-only run; --dry-run only affects --apply)"
      : "\n(read-only run; pass --apply to apply suggestions)");
    return 0;
  }

  logger.log("\n=== apply ===");
  const targets = MODULES.filter((module) => !args.skip.has(module.name));
  for (const module of targets) {
    logger.log(`-> ${module.name}`);
    const options = { runner, dryRun: args.dryRun, logger };
    if (module.name === "ssh-hardening") options.mode = args.sshMode;
    const result = await module.apply(options);
    logger.log(`   result: ${JSON.stringify(result)}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
