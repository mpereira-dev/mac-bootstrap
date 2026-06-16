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

// Interactive arrow-key picker. Works only on a TTY because it relies on raw
// mode + ANSI cursor control. Bootstrap auto-falls-back to pickProfiles when
// stdin is not a TTY (CI, tests, redirected input).
//
// Controls:
//   ↑ / ↓ / j / k   move the cursor
//   space           toggle the current row
//   a               toggle all
//   enter           confirm
//   q / esc / ctrl-c cancel (throws so bootstrap can exit cleanly)
export async function pickProfilesInteractive({
  manifest,
  defaults,
  input = process.stdin,
  output = process.stdout
}) {
  const profileNames = Object.keys(manifest.profiles || {});
  if (profileNames.length === 0) {
    return [];
  }

  const selected = new Set(defaults);
  let cursor = 0;
  let linesWritten = 0;

  const composeFrame = () => {
    const lines = [];
    lines.push("Select profiles to enable.");
    lines.push("  ↑/↓ navigate   space toggle   a toggle all   enter confirm   q cancel");
    lines.push("");
    for (let i = 0; i < profileNames.length; i += 1) {
      const name = profileNames[i];
      const def = manifest.profiles[name] || {};
      const isOn = selected.has(name);
      const isHere = i === cursor;
      const pointer = isHere ? "❯" : " ";
      const box = isOn ? "[x]" : "[ ]";
      const packages = packagesForProfile(manifest, name).join(", ") || "(no packages)";
      const title = `${pointer} ${box} ${name.padEnd(8)}  ${def.description || ""}`.trimEnd();
      lines.push(title);
      lines.push(`         ${packages}`);
    }
    lines.push("");
    const enabled = profileNames.filter((name) => selected.has(name));
    lines.push(`Enabled: ${enabled.length > 0 ? enabled.join(", ") : "(none)"}`);
    return lines.join("\n") + "\n";
  };

  const eraseFrame = () => {
    if (linesWritten === 0) return;
    readline.moveCursor(output, 0, -linesWritten);
    readline.cursorTo(output, 0);
    readline.clearScreenDown(output);
  };

  const renderFrame = () => {
    eraseFrame();
    const frame = composeFrame();
    output.write(frame);
    linesWritten = frame.split("\n").length - 1;
  };

  readline.emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  if (typeof input.setRawMode === "function") {
    input.setRawMode(true);
  }
  input.resume();

  return new Promise((resolve, reject) => {
    const restore = () => {
      input.off("keypress", onKeypress);
      if (typeof input.setRawMode === "function") {
        input.setRawMode(wasRaw);
      }
      input.pause();
    };

    function onKeypress(_str, key) {
      if (!key) return;
      if ((key.ctrl && key.name === "c") || key.name === "escape" || key.name === "q") {
        restore();
        reject(new Error("Profile selection cancelled."));
        return;
      }
      if (key.name === "up" || key.name === "k") {
        cursor = (cursor - 1 + profileNames.length) % profileNames.length;
        renderFrame();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % profileNames.length;
        renderFrame();
        return;
      }
      if (key.name === "space") {
        const name = profileNames[cursor];
        if (selected.has(name)) {
          selected.delete(name);
        } else {
          selected.add(name);
        }
        renderFrame();
        return;
      }
      if (key.name === "a") {
        if (selected.size === profileNames.length) {
          selected.clear();
        } else {
          for (const name of profileNames) selected.add(name);
        }
        renderFrame();
        return;
      }
      if (key.name === "return") {
        restore();
        resolve(profileNames.filter((name) => selected.has(name)));
      }
    }

    input.on("keypress", onKeypress);
    renderFrame();
  });
}
