import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { bootstrap } from "../src/bootstrap.js";
import { doctor } from "../src/doctor.js";
import { loadManifest } from "../src/manifest.js";
import { FakeRunner, tempHome, TestLogger } from "./helpers.js";

test("doctor passes after isolated bootstrap", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  await bootstrap({ home, runner, logger: new TestLogger(), networkCheck: async () => true });
  const logger = new TestLogger();
  const exitCode = await doctor({ home, runner, logger });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /ok - formula gh/);
});

test("doctor fails on expected version mismatch", async () => {
  const home = tempHome();
  const manifest = loadManifest();
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
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await doctor({ dryRun: true, home, runner, logger });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /check node v22/);
  assert.equal(runner.calls.length, 0);
});
