import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tempHome } from "../test/helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const command of ["bootstrap", "nightly", "doctor"]) {
  test(`${command} dry-run exits successfully`, () => {
    const home = tempHome();
    const result = spawnSync(path.join(repoRoot, "bin", command), ["--dry-run", "--home", home], {
      encoding: "utf8",
      env: { ...process.env, HOME: home }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[dry-run\]/);
    assert.equal(result.stderr, "");
  });
}
