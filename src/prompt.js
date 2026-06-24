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
  const presetNames = Object.keys(manifest.presets || {});
  if (presetNames.length > 0) {
    logger.log(
      `Tip: skip these prompts with a preset — e.g. \`--preset ${presetNames[0]}\` (${presetNames.join(", ")}).`
    );
    logger.log("");
  }
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
// The cursor walks a combined list: preset codenames first (a shortcut that
// fills in a whole profile set), then the per-profile toggles. When the manifest
// declares no presets the list is just the profiles, so behaviour is unchanged.
//
// Controls:
//   ↑ / ↓ / j / k   move the cursor
//   space           toggle a profile row, or apply a preset row
//   a               toggle all profiles
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
  const presetNames = Object.keys(manifest.presets || {});

  // Presets lead so the one-word shortcut is the first thing the cursor lands
  // on; profiles follow for fine-grained toggling.
  const rows = [
    ...presetNames.map((name) => ({ kind: "preset", name })),
    ...profileNames.map((name) => ({ kind: "profile", name }))
  ];

  const selected = new Set(defaults);
  let cursor = 0;
  let linesWritten = 0;

  // A preset row reads as [x] when the current selection is exactly its set.
  const matchesPreset = (name) => {
    const want = (manifest.presets[name].profiles || []).filter((p) => profileNames.includes(p));
    return want.length === selected.size && want.every((p) => selected.has(p));
  };

  const composeFrame = () => {
    const lines = [];
    lines.push("Select profiles to enable — or pick a preset to fill them in.");
    lines.push("  ↑/↓ navigate   space toggle/apply   a toggle all   enter confirm   q cancel");
    let lastKind = null;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.kind !== lastKind) {
        lines.push("");
        lines.push(row.kind === "preset" ? "Presets (one word → a profile set):" : "Profiles:");
        lastKind = row.kind;
      }
      const isHere = i === cursor;
      const pointer = isHere ? "❯" : " ";
      if (row.kind === "preset") {
        const def = manifest.presets[row.name] || {};
        const box = matchesPreset(row.name) ? "[x]" : "[ ]";
        const title = `${pointer} ${box} ${row.name.padEnd(8)}  ${def.description || ""}`.trimEnd();
        lines.push(title);
        lines.push(`         ${(def.profiles || []).join(", ")}`);
      } else {
        const def = manifest.profiles[row.name] || {};
        const box = selected.has(row.name) ? "[x]" : "[ ]";
        const packages = packagesForProfile(manifest, row.name).join(", ") || "(no packages)";
        const title = `${pointer} ${box} ${row.name.padEnd(8)}  ${def.description || ""}`.trimEnd();
        lines.push(title);
        lines.push(`         ${packages}`);
      }
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
        cursor = (cursor - 1 + rows.length) % rows.length;
        renderFrame();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % rows.length;
        renderFrame();
        return;
      }
      if (key.name === "space") {
        const row = rows[cursor];
        if (row.kind === "preset") {
          // Applying a preset replaces the current selection with its set.
          selected.clear();
          for (const profile of manifest.presets[row.name].profiles || []) {
            if (profileNames.includes(profile)) selected.add(profile);
          }
        } else if (selected.has(row.name)) {
          selected.delete(row.name);
        } else {
          selected.add(row.name);
        }
        renderFrame();
        return;
      }
      if (key.name === "a") {
        // Toggle-all acts on profiles only; presets are shortcuts, not toggles.
        if (profileNames.every((name) => selected.has(name))) {
          for (const name of profileNames) selected.delete(name);
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
