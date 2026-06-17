import assert from "node:assert/strict";
import test from "node:test";
import { loadManifest } from "../src/manifest.js";
import { buildPlan, migrate, parseRemovable, resolveManagedInstall } from "../src/migrate.js";
import { FakeRunner, TestLogger } from "./helpers.js";

// A provenance record for the standalone-.pkg AWS CLI: manifest manages `aws`
// (formula awscli), but it was installed a different way → MIGRATE.
const awsRecord = {
  name: "aws",
  status: "found",
  manager: "macos-pkg",
  remove: "# remove per vendor docs, then forget the receipt: sudo pkgutil --forget com.amazon.aws.cli2",
  verdict: "MIGRATE"
};

// A cleanly-removable record: npm-global tool that the manifest manages.
const npmRecord = {
  name: "aws",
  status: "found",
  manager: "npm-global",
  remove: "npm uninstall -g aws",
  verdict: "MIGRATE"
};

const fakeProvenance = (records) => async () => records;

test("resolveManagedInstall maps node to Volta", () => {
  const manifest = loadManifest();
  const install = resolveManagedInstall({ name: "node" }, manifest);
  assert.deepEqual(install, { command: "volta", args: ["install", "node@24"] });
});

test("resolveManagedInstall maps a command to its brew formula", () => {
  const manifest = loadManifest();
  const install = resolveManagedInstall({ name: "aws" }, manifest);
  assert.equal(install.command, "/opt/homebrew/bin/brew");
  assert.deepEqual(install.args, ["install", "awscli"]);
});

test("resolveManagedInstall returns null for unknown tools", () => {
  const manifest = loadManifest();
  assert.equal(resolveManagedInstall({ name: "totally-unknown" }, manifest), null);
});

test("parseRemovable refuses placeholders and comments", () => {
  assert.equal(parseRemovable("pnpm remove --global <package>").runnable, false);
  assert.equal(parseRemovable("# manual copy").runnable, false);
  assert.deepEqual(parseRemovable("npm uninstall -g aws"), {
    runnable: true,
    command: "npm",
    args: ["uninstall", "-g", "aws"]
  });
});

test("buildPlan marks a comment-only removal as manual", () => {
  const plan = buildPlan(awsRecord, loadManifest());
  assert.equal(plan.removable, false);
  assert.equal(plan.install.args.at(-1), "awscli");
});

test("migrate with no MIGRATE records does nothing", async () => {
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const code = await migrate({
    runner,
    logger,
    readProvenance: fakeProvenance([{ name: "git", verdict: "OK" }, { name: "cdk", verdict: "UNMANAGED" }])
  });
  assert.equal(code, 0);
  assert.match(logger.text(), /Nothing to migrate/);
  assert.equal(runner.calls.length, 0);
});

test("migrate plan-only never touches the machine", async () => {
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const code = await migrate({ runner, logger, readProvenance: fakeProvenance([npmRecord]) });
  assert.equal(code, 0);
  assert.match(logger.text(), /Plan only/);
  assert.match(logger.text(), /install managed : \/opt\/homebrew\/bin\/brew install awscli/);
  assert.equal(runner.calls.length, 0);
});

test("migrate --apply installs managed then removes a runnable old copy", async () => {
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const code = await migrate({
    apply: true,
    runner,
    logger,
    readProvenance: fakeProvenance([npmRecord])
  });
  assert.equal(code, 0);
  const calls = runner.calls.map((c) => c.join(" "));
  assert.ok(calls.includes("/opt/homebrew/bin/brew install awscli"), "managed install ran");
  assert.ok(calls.includes("npm uninstall -g aws"), "old copy removed");
  // install must precede removal
  assert.ok(
    calls.indexOf("/opt/homebrew/bin/brew install awscli") < calls.indexOf("npm uninstall -g aws"),
    "install happens before removal"
  );
});

test("migrate --apply leaves manual-removal tools for the user", async () => {
  const runner = new FakeRunner();
  const logger = new TestLogger();
  const code = await migrate({
    apply: true,
    runner,
    logger,
    readProvenance: fakeProvenance([awsRecord])
  });
  assert.equal(code, 0);
  const calls = runner.calls.map((c) => c.join(" "));
  assert.ok(calls.includes("/opt/homebrew/bin/brew install awscli"), "managed install ran");
  assert.ok(!calls.some((c) => c.startsWith("sudo pkgutil")), "no auto pkgutil removal");
  assert.match(logger.text(), /manual removal needed/);
});

test("migrate --apply keeps the old copy when install fails", async () => {
  const runner = new FakeRunner({ failInstall: new Set(["awscli"]) });
  const logger = new TestLogger();
  const code = await migrate({
    apply: true,
    runner,
    logger,
    readProvenance: fakeProvenance([npmRecord])
  });
  assert.equal(code, 1);
  const calls = runner.calls.map((c) => c.join(" "));
  assert.ok(!calls.includes("npm uninstall -g aws"), "old copy NOT removed after failed install");
  assert.match(logger.text(), /install failed/);
});
