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

// Resolve a named preset (codename) to its profile list. Returns null for an
// unknown name so the caller can report the available ones.
export function resolvePreset(manifest, name) {
  const preset = (manifest.presets || {})[name];
  return preset && Array.isArray(preset.profiles) ? preset.profiles : null;
}
