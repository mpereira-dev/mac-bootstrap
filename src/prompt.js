import readline from "node:readline";

// Plain readline yes/no. Returns the default if the user just hits enter. Lives
// in its own module so tests can inject a fake prompt without spinning up tty.
export async function askYesNo(question, defaultYes = true, input = process.stdin, output = process.stdout) {
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await new Promise((resolve) => {
      rl.question(question + suffix, (value) => resolve(value));
    });
    const trimmed = (answer || "").trim().toLowerCase();
    if (trimmed === "") return defaultYes;
    if (trimmed === "y" || trimmed === "yes") return true;
    return false;
  } finally {
    rl.close();
  }
}

// Walks the profiles defined in the manifest, showing each with its package
// list and a [x]/[ ] indicator reflecting the current default-or-saved choice,
// then asks per-profile yes/no. The chosen list is returned in manifest order so
// install logs stay predictable.
export async function pickProfiles({ manifest, logger, defaults, input, output, prompt = askYesNo }) {
  const profileNames = Object.keys(manifest.profiles || {});
  const defaultsSet = new Set(defaults);

  logger.log("");
  logger.log("Available profiles:");
  for (const name of profileNames) {
    const def = manifest.profiles[name] || {};
    const packages = packagesForProfile(manifest, name).join(", ");
    const mark = defaultsSet.has(name) ? "[x]" : "[ ]";
    logger.log(`  ${mark} ${name.padEnd(8)} ${packages || "(no packages)"}`);
    if (def.description) {
      logger.log(`         ${def.description}`);
    }
  }
  logger.log("");

  const selected = [];
  for (const name of profileNames) {
    const isDefault = defaultsSet.has(name);
    const want = await prompt(`Enable ${name}?`, isDefault, input, output);
    if (want) {
      selected.push(name);
    }
  }
  return selected;
}

export function packagesForProfile(manifest, profileName) {
  const formulae = (manifest.formulae || [])
    .filter((entry) => entry.profile === profileName)
    .map((entry) => entry.name);
  const casks = (manifest.casks || [])
    .filter((entry) => entry.profile === profileName)
    .map((entry) => entry.name);
  return [...formulae, ...casks];
}
