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
