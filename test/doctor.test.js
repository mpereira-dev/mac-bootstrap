import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { bootstrap } from "../src/bootstrap.js";
import { doctor } from "../src/doctor.js";
import { loadManifest } from "../src/manifest.js";
import { FakeRunner, tempHome, TestLogger, writeSavedSelections } from "./helpers.js";

const ALL_PROFILES = ["core", "node", "python", "ai", "mobile", "network", "cloud"];

test("doctor passes after isolated bootstrap", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  await bootstrap({ home, runner, logger: new TestLogger(), profiles: ALL_PROFILES, networkCheck: async () => true });
  const logger = new TestLogger();
  const exitCode = await doctor({ home, runner, logger });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /ok - formula gh/);
});

test("doctor fails on expected version mismatch", async () => {
  const home = tempHome();
  const manifest = loadManifest();
  writeSavedSelections(home, ALL_PROFILES);
  const runner = new FakeRunner({
    formulae: manifest.formulae.map((formula) => formula.name),
    casks: manifest.casks.map((cask) => cask.name),
    nodeVersion: "v20.0.0"
  });
  fs.mkdirSync(path.join(home, "Library", "LaunchAgents"), { recursive: true });
  fs.mkdirSync(path.join(home, "Library", "Logs"), { recursive: true });
  fs.writeFileSync(path.join(home, ".zshrc"), "# mac-bootstrap managed baseline\n");
  const logger = new TestLogger();
  const exitCode = await doctor({ home, runner, logger });
  assert.equal(exitCode, 1);
  assert.match(logger.text(), /fail - Node runtime/);
});

test("doctor dry-run prints checks and does nothing", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["core", "node", "ai"]);
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await doctor({ dryRun: true, home, runner, logger });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /check node v24/);
  assert.equal(runner.calls.length, 0);
});

test("doctor skips disabled formulae and casks", async () => {
  const home = tempHome();
  const manifest = loadManifest();
  const coreFormulae = manifest.formulae
    .filter((formula) => formula.profile === "core")
    .map((formula) => formula.name);
  writeSavedSelections(home, ["core"]);
  fs.mkdirSync(path.join(home, "Library", "LaunchAgents"), { recursive: true });
  fs.mkdirSync(path.join(home, "Library", "Logs"), { recursive: true });
  fs.writeFileSync(path.join(home, ".zshrc"), "# mac-bootstrap managed baseline\n");
  const runner = new FakeRunner({ formulae: coreFormulae });
  const logger = new TestLogger();
  const exitCode = await doctor({ home, runner, logger });
  assert.equal(exitCode, 0, logger.text());
  assert.match(logger.text(), /ok - formula gh/);
  assert.doesNotMatch(logger.text(), /formula volta/);
  assert.doesNotMatch(logger.text(), /cask claude-code/);
  assert.doesNotMatch(logger.text(), /Volta Node/);
});
