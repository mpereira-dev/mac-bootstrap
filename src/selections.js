import fs from "node:fs";
import path from "node:path";

// Persisted profile selections live alongside other mac-bootstrap state so a
// fresh shell never re-prompts for the same choices. Re-prompt is opt-in via
// --reconfigure (or by deleting this file). nightly upkeep reads it too so the
// unattended job stays aligned with what the laptop actually opted into.
export function selectionsPath(home) {
  return path.join(home, ".mac-bootstrap", "profiles.json");
}

export function loadSelections(home) {
  const file = selectionsPath(home);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && Array.isArray(parsed.profiles)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSelections(home, profiles, savedAt = new Date().toISOString()) {
  const file = selectionsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = { profiles, savedAt };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

export function defaultProfiles(manifest) {
  return Object.entries(manifest.profiles || {})
    .filter(([, def]) => def && def.defaultEnabled)
    .map(([name]) => name);
}

export function hiddenProfiles(manifest) {
  return Object.entries(manifest.profiles || {})
    .filter(([, def]) => def && def.hidden)
    .map(([name]) => name);
}

// The profile names the interactive picker should offer. By default hidden
// profiles (ai/mobile/network) are omitted to keep the common path short; pass
// `all` to reveal every profile. Names in `include` are always shown so a
// reconfigure never silently drops a hidden profile that is already enabled.
export function profileNamesToShow(manifest, { all = false, include = [] } = {}) {
  const everyName = Object.keys(manifest.profiles || {});
  if (all) {
    return everyName;
  }
  const hidden = new Set(hiddenProfiles(manifest));
  const keep = new Set(include);
  return everyName.filter((name) => !hidden.has(name) || keep.has(name));
}
