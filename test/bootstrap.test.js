import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { bootstrap, ensureFormula } from "../src/bootstrap.js";
import { loadManifest } from "../src/manifest.js";
import { FakeRunner, tempHome, TestLogger, writeSavedSelections } from "./helpers.js";
import { loadSelections, selectionsPath } from "../src/selections.js";

const ALL_PROFILES = ["core", "node", "python", "ai", "mobile", "network", "cloud"];

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
  const exitCode = await bootstrap({ home, runner, logger, profiles: ALL_PROFILES, networkCheck: async () => true });
  assert.equal(exitCode, 0);
  assert.equal(runner.formulae.has("gh"), true);
  assert.equal(runner.casks.has("claude-code"), true);
  assert.match(logger.text(), /Bootstrap complete/);
});

test("bootstrap continues when one formula fails and returns failure", async () => {
  const home = tempHome();
  const runner = new FakeRunner({ failInstall: new Set(["ripgrep"]) });
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, profiles: ALL_PROFILES, networkCheck: async () => true });
  assert.equal(exitCode, 1);
  assert.equal(runner.formulae.has("git"), true);
  assert.equal(runner.formulae.has("jq"), true);
  assert.match(logger.text(), /formula:ripgrep/);
});

test("bootstrap returns 2 when network is unavailable", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, profiles: ALL_PROFILES, networkCheck: async () => false });
  assert.equal(exitCode, 2);
  assert.equal(runner.calls.length, 0);
});

test("bootstrap dry-run prints actions and does nothing", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ dryRun: true, home, runner, logger, profiles: ALL_PROFILES, networkCheck: async () => false });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /brew install gh if missing/);
  assert.equal(runner.calls.length, 0);
  assert.equal(fs.existsSync(selectionsPath(home)), false);
});

test("bootstrap preset dry-run does not save the profile selection", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ dryRun: true, home, runner, logger, preset: "scout" });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /\[dry-run\] using --profiles override without saving: core, node, python/);
  assert.equal(fs.existsSync(selectionsPath(home)), false);
});

test("bootstrap with core profile installs only core packages", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, profiles: ["core"], networkCheck: async () => true });
  assert.equal(exitCode, 0);
  assert.equal(runner.formulae.has("gh"), true);
  assert.equal(runner.formulae.has("volta"), false);
  assert.equal(runner.casks.has("claude-code"), false);
});

test("bootstrap creates ~/.local/bin and adds it to the zsh baseline behind Volta", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, profiles: ["core"], networkCheck: async () => true });
  assert.equal(exitCode, 0);
  assert.equal(fs.existsSync(path.join(home, ".local", "bin")), true);
  const zshrc = fs.readFileSync(path.join(home, ".zshrc"), "utf8");
  assert.match(zshrc, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
  // ~/.local/bin line must come before the Volta prepend so Volta stays earliest.
  assert.ok(zshrc.indexOf("$HOME/.local/bin") < zshrc.indexOf("$VOLTA_HOME/bin"));
});

test("bootstrap upgrades an existing managed block to add ~/.local/bin once", async () => {
  const home = tempHome();
  const legacyBlock = [
    "",
    "# mac-bootstrap managed baseline",
    "export VOLTA_HOME=\"$HOME/.volta\"",
    "export PATH=\"$VOLTA_HOME/bin:$PATH\"",
    "# end mac-bootstrap managed baseline",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(home, ".zshrc"), legacyBlock);
  const runner = new FakeRunner();
  await bootstrap({ home, runner, logger: new TestLogger(), profiles: ["core"], networkCheck: async () => true });
  let zshrc = fs.readFileSync(path.join(home, ".zshrc"), "utf8");
  assert.equal((zshrc.match(/\$HOME\/\.local\/bin/g) || []).length, 1);
  assert.ok(zshrc.indexOf("$HOME/.local/bin") < zshrc.indexOf("$VOLTA_HOME/bin"));
  // Re-running must not duplicate the line.
  await bootstrap({ home, runner, logger: new TestLogger(), profiles: ["core"], networkCheck: async () => true });
  zshrc = fs.readFileSync(path.join(home, ".zshrc"), "utf8");
  assert.equal((zshrc.match(/\$HOME\/\.local\/bin/g) || []).length, 1);
});

test("bootstrap installs Corepack through Volta so it lands on PATH", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, profiles: ["node"], networkCheck: async () => true });
  assert.equal(exitCode, 0);
  assert.ok(runner.calls.some((call) => call.join(" ") === "volta install corepack"));
  // No ~/.volta/bin/corepack shim in the temp home, so it falls back to bare `corepack`.
  assert.ok(runner.calls.some((call) => call.join(" ") === "corepack enable"));
});

test("bootstrap enables Corepack via the absolute Volta shim when present", async () => {
  const home = tempHome();
  const voltaBin = path.join(home, ".volta", "bin");
  fs.mkdirSync(voltaBin, { recursive: true });
  const shim = path.join(voltaBin, "corepack");
  fs.writeFileSync(shim, "#!/bin/sh\n", { mode: 0o755 });
  const runner = new FakeRunner();
  const exitCode = await bootstrap({ home, runner, logger: new TestLogger(), profiles: ["node"], networkCheck: async () => true });
  assert.equal(exitCode, 0);
  // The fresh-shell ENOENT fix: enable through the absolute shim, not bare `corepack`.
  assert.ok(runner.calls.some((call) => call.join(" ") === `${shim} enable`));
  assert.equal(runner.calls.some((call) => call.join(" ") === "corepack enable"), false);
});

test("bootstrap prompts on first run and saves every accepted profile", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  // Every profile is offered now (no hide feature); prompt: () => true accepts all.
  const exitCode = await bootstrap({
    home,
    runner,
    logger,
    networkCheck: async () => true,
    prompt: async () => true
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(loadSelections(home).profiles, ALL_PROFILES);
  assert.equal(runner.formulae.has("gh"), true);
  assert.equal(runner.formulae.has("uv"), true);
  assert.equal(runner.formulae.has("cocoapods"), true);
  assert.equal(runner.casks.has("tailscale-app"), true);
  assert.equal(runner.casks.has("claude-code"), true);
});

test("bootstrap --preset expands a codename to its profiles and saves it", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, preset: "ranger", networkCheck: async () => true });
  assert.equal(exitCode, 0);
  assert.deepEqual(loadSelections(home).profiles, ["core", "node", "python", "cloud"]);
  assert.equal(runner.formulae.has("awscli"), true); // cloud
  assert.equal(runner.formulae.has("uv"), true); // python
  assert.equal(runner.casks.has("claude-code"), false); // ai not in ranger
  assert.equal(runner.formulae.has("cocoapods"), false); // mobile not in ranger
});

test("bootstrap rejects an unknown preset", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, preset: "bogus", networkCheck: async () => true });
  assert.equal(exitCode, 2);
  assert.match(logger.text(), /Unknown preset: bogus/);
});

test("bootstrap respects saved selection without prompting", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["core"]);
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({
    home,
    runner,
    logger,
    networkCheck: async () => true,
    prompt: async () => {
      throw new Error("prompt should not be called");
    }
  });
  assert.equal(exitCode, 0);
  assert.equal(runner.formulae.has("gh"), true);
  assert.equal(runner.casks.has("claude-code"), false);
});

test("bootstrap reconfigure prompts even with saved selection", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["core"]);
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({
    home,
    runner,
    logger,
    reconfigure: true,
    networkCheck: async () => true,
    prompt: async (question) => question.includes("ai")
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(loadSelections(home).profiles, ["ai"]);
  assert.equal(runner.formulae.has("gh"), false);
  assert.equal(runner.casks.has("claude-code"), true);
});

test("bootstrap yes uses defaults with no saved file", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await bootstrap({ home, runner, logger, yes: true, networkCheck: async () => true });
  assert.equal(exitCode, 0);
  assert.equal(runner.formulae.has("gh"), true);
  // python is a default profile now, so uv is installed by --yes.
  assert.equal(runner.formulae.has("uv"), true);
  assert.equal(runner.formulae.has("cocoapods"), false);
  // ai is not a default profile, so claude-code is not installed by --yes.
  assert.equal(runner.casks.has("claude-code"), false);
  assert.equal(runner.casks.has("tailscale-app"), false);
  assert.equal(fs.existsSync(selectionsPath(home)), false);
});
