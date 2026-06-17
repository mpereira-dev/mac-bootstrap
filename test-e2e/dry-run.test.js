import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tempHome, writeSavedSelections } from "../test/helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const command of ["bootstrap", "nightly", "doctor"]) {
  test(`${command} dry-run exits successfully`, () => {
    const home = tempHome();
    writeSavedSelections(home, ["core", "node", "ai"]);
    const result = spawnSync(path.join(repoRoot, "bin", command), ["--dry-run", "--home", home], {
      encoding: "utf8",
      env: { ...process.env, HOME: home }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[dry-run\]/);
    assert.equal(result.stderr, "");
  });
}

for (const [command, args, expected] of [
  ["bootstrap", ["--help", "profiles"], /Profile/],
  ["migrate", ["--help", "detection"], /installer is identified/]
]) {
  test(`${command} topic help exits successfully`, () => {
    const result = spawnSync(path.join(repoRoot, "bin", command), args, {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}
