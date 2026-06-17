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

test("mac-bootstrap root help exits successfully", () => {
  const result = spawnSync(path.join(repoRoot, "bin", "mac-bootstrap"), ["--help"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: mac-bootstrap <command> \[args\]/);
  assert.match(result.stdout, /doctor/);
  assert.doesNotMatch(result.stdout, /\[INFO\]/);
  assert.equal(result.stderr, "");
});

test("mac-bootstrap bare dry-run dispatches to bootstrap for compatibility", () => {
  const home = tempHome();
  writeSavedSelections(home, ["core", "node", "ai"]);
  const result = spawnSync(path.join(repoRoot, "bin", "mac-bootstrap"), ["--dry-run", "--home", home], {
    encoding: "utf8",
    env: { ...process.env, HOME: home }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[dry-run\] bootstrap plan/);
  assert.equal(result.stderr, "");
});

test("mac-bootstrap bootstrap dry-run works without node on PATH", () => {
  const result = spawnSync(path.join(repoRoot, "bin", "mac-bootstrap"), ["bootstrap", "--dry-run"], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Node\.js is not on PATH/);
  assert.match(result.stdout, /would install Node 24/);
});

for (const [command, args, expected] of [
  ["bootstrap", ["--help", "profiles"], /Profile/],
  ["doctor", ["--help", "fixes"], /respond when doctor reports drift/],
  ["nightly", ["--help", "logs"], /mac-bootstrap-nightly\.log/],
  ["migrate", ["--help", "detection"], /installer is identified/],
  ["security", ["--help", "modules"], /filevault/]
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

test("mac-bootstrap deep help reaches command topics", () => {
  const result = spawnSync(path.join(repoRoot, "bin", "mac-bootstrap"), ["help", "security", "modules"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /filevault/);
  assert.doesNotMatch(result.stdout, /\[INFO\]/);
  assert.equal(result.stderr, "");
});

test("legacy command help is not structured-log prefixed", () => {
  const result = spawnSync(path.join(repoRoot, "bin", "security"), ["--help", "modules"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /security .* modules/);
  assert.doesNotMatch(result.stdout, /\[INFO\]/);
  assert.equal(result.stderr, "");
});
