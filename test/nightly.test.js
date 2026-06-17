import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { nightly, rotateLogs } from "../src/nightly.js";
import { FakeRunner, tempHome, TestLogger, writeSavedSelections } from "./helpers.js";

test("nightly happy path runs maintenance and logs summary", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["core", "node", "ai"]);
  const runner = new FakeRunner({ formulae: ["git"], casks: ["claude-code"] });
  const logger = new TestLogger();
  let discordPosted = false;
  const exitCode = await nightly({
    home,
    runner,
    logger,
    env: { DISCORD_WEBHOOK_URL: "https://discord.example/webhook" },
    networkCheck: async () => true,
    postDiscord: async () => {
      discordPosted = true;
    }
  });
  assert.equal(exitCode, 0);
  assert.equal(discordPosted, true);
  assert.match(fs.readFileSync(path.join(home, "Library", "Logs", "mac-bootstrap-nightly.log"), "utf8"), /nightly summary/);
});

test("nightly returns 2 when network is unavailable", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["core", "node", "ai"]);
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await nightly({ home, runner, logger, networkCheck: async () => false });
  assert.equal(exitCode, 2);
  assert.equal(runner.calls.length, 0);
});

test("nightly reports command failure", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["core", "node", "ai"]);
  const failSteps = new Map([["/opt/homebrew/bin/brew upgrade", "network dropped"]]);
  const runner = new FakeRunner({ failSteps });
  const logger = new TestLogger();
  const exitCode = await nightly({ home, runner, logger, networkCheck: async () => true, env: {} });
  assert.equal(exitCode, 1);
  assert.match(logger.text(), /brew upgrade failed/);
});

test("nightly dry-run prints actions and does nothing", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["core", "node", "ai"]);
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await nightly({ dryRun: true, home, runner, logger, networkCheck: async () => false });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /brew upgrade --cask/);
  assert.equal(runner.calls.length, 0);
});

test("nightly skips self-update for disabled casks", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["core"]);
  const runner = new FakeRunner({ casks: ["claude-code"] });
  const logger = new TestLogger();
  const exitCode = await nightly({ home, runner, logger, networkCheck: async () => true, env: {} });
  assert.equal(exitCode, 0);
  assert.equal(runner.calls.some((call) => call.join(" ") === "claude update"), false);
});

test("nightly strips quarantine from enabled cask helper binaries after cask upgrades", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["ai"]);
  const runner = new FakeRunner({ casks: ["codex"] });
  const helper = path.join(runner.homebrewPrefix, "Caskroom", "codex", "1.2.3", "codex-path", "rg");
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.writeFileSync(helper, "fake rg");
  const originalRun = runner.run.bind(runner);
  runner.run = (command, args = [], options = {}) => {
    if (command === "/usr/bin/xattr" && args[0] === "-p" && args[2] === helper) {
      runner.calls.push([command, ...args]);
      return { status: 0, exitCode: 0, stdout: "0081;codex;Homebrew Cask;\n", stderr: "" };
    }
    if (command === "/usr/bin/xattr" && args[0] === "-d" && args[2] === helper) {
      runner.calls.push([command, ...args]);
      return { status: 0, exitCode: 0, stdout: "", stderr: "" };
    }
    return originalRun(command, args, options);
  };
  const logger = new TestLogger();
  const exitCode = await nightly({ home, runner, logger, networkCheck: async () => true, env: {} });
  assert.equal(exitCode, 0, logger.text());
  assert.ok(runner.calls.some((call) => call.join(" ") === `/usr/bin/xattr -d com.apple.quarantine ${helper}`));
});

test("nightly dry-run includes the cask quarantine sweep", async () => {
  const home = tempHome();
  writeSavedSelections(home, ["ai"]);
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await nightly({ dryRun: true, home, runner, logger, networkCheck: async () => false });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /strip quarantine from nested Homebrew Cask helper binaries/);
  assert.equal(runner.calls.length, 0);
});

test("rotateLogs keeps recent logs and removes stale logs", () => {
  const home = tempHome();
  const logPath = path.join(home, "Library", "Logs", "mac-bootstrap-nightly.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, "old");
  const stale = `${logPath}.stale`;
  fs.writeFileSync(stale, "stale");
  const old = Date.now() - 9 * 24 * 60 * 60 * 1000;
  fs.utimesSync(stale, old / 1000, old / 1000);
  rotateLogs(logPath, 7);
  assert.equal(fs.existsSync(logPath), false);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.readdirSync(path.dirname(logPath)).some((entry) => entry.includes("mac-bootstrap-nightly.log.")), true);
});
