import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadManifest(manifestPath = path.join(repoRoot(), "packages.json")) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return {
    homebrewPrefix: "/opt/homebrew",
    defaultNode: "22",
    formulae: [],
    casks: [],
    npmGlobals: [],
    ...manifest
  };
}

export function brewPath(manifest) {
  return path.join(manifest.homebrewPrefix, "bin", "brew");
}

// Returns a shallow copy of the manifest with formulae and casks restricted to
// entries whose `profile` is in the selected set. Entries without a `profile`
// field are always kept so older manifests stay installable. Order is preserved
// so install logs match manifest order.
export function filterByProfiles(manifest, profiles) {
  const allowed = new Set(profiles);
  return {
    ...manifest,
    formulae: (manifest.formulae || []).filter(
      (entry) => !entry.profile || allowed.has(entry.profile)
    ),
    casks: (manifest.casks || []).filter(
      (entry) => !entry.profile || allowed.has(entry.profile)
    )
  };
}
