import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { nightly, rotateLogs } from "../src/nightly.js";
import { FakeRunner, tempHome, TestLogger } from "./helpers.js";

test("nightly happy path runs maintenance and logs summary", async () => {
  const home = tempHome();
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
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await nightly({ home, runner, logger, networkCheck: async () => false });
  assert.equal(exitCode, 2);
  assert.equal(runner.calls.length, 0);
});

test("nightly reports command failure", async () => {
  const home = tempHome();
  const failSteps = new Map([["/opt/homebrew/bin/brew upgrade", "network dropped"]]);
  const runner = new FakeRunner({ failSteps });
  const logger = new TestLogger();
  const exitCode = await nightly({ home, runner, logger, networkCheck: async () => true, env: {} });
  assert.equal(exitCode, 1);
  assert.match(logger.text(), /brew upgrade failed/);
});

test("nightly dry-run prints actions and does nothing", async () => {
  const home = tempHome();
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const exitCode = await nightly({ dryRun: true, home, runner, logger, networkCheck: async () => false });
  assert.equal(exitCode, 0);
  assert.match(logger.text(), /brew upgrade --cask/);
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
