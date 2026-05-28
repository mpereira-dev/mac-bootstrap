import assert from "node:assert/strict";
import test from "node:test";
import { bootstrap, ensureFormula } from "../src/bootstrap.js";
import { loadManifest } from "../src/manifest.js";
import { FakeRunner, tempHome, TestLogger } from "./helpers.js";

test("ensureFormula installs a missing formula", () => {
  const manifest = loadManifest();
  const runner = new FakeRunner();
  const result = ensureFormula(runner, manifest, "ripgrep");
  assert.equal(result.ok, true);
  assert.equal(runner.formulae.has("ripgrep"), true);
});

test("ensureFormula is idempotent when already installed", () => {
  const manifest = loadManifest();
  const runner = new FakeRunner({ formulae: ["ripgrep"] });
  const result = ensureFormula(runner, manifest, "ripgrep");
  assert.deepEqual(result, { ok: true, changed: false });
  assert.equal(runner.calls.some((call) => call.join(" ").includes("install ripgrep")), false);
});

test("bootstrap happy path installs formulae and casks", async () => {
  const home = tempHome();
  const runner = new FakeRunner({ xcodeInstalled: false });
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, networkCheck: async () => true });
  assert.equal(exitCode, 0);
  assert.equal(runner.formulae.has("gh"), true);
  assert.equal(runner.casks.has("claude-code"), true);
  assert.match(logger.text(), /Bootstrap complete/);
});

test("bootstrap continues when one formula fails and returns failure", async () => {
  const home = tempHome();
  const runner = new FakeRunner({ failInstall: new Set(["ripgrep"]) });
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, networkCheck: async () => true });
  assert.equal(exitCode, 1);
  assert.equal(runner.formulae.has("git"), true);
  assert.equal(runner.formulae.has("jq"), true);
  assert.match(logger.text(), /formula:ripgrep/);
});

test("bootstrap returns 2 when network is unavailable", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, networkCheck: async () => false });
  assert.equal(exitCode, 2);
  assert.equal(runner.calls.length, 0);
});

test("bootstrap dry-run prints actions and does nothing", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ dryRun: true, home, runner, logger, networkCheck: async () => false });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /brew install gh if missing/);
  assert.equal(runner.calls.length, 0);
});
