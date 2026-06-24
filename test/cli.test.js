import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrateArgs, parseSecurityArgs, printRootHelp, resolveCommand } from "../src/cli.js";
import { TestLogger } from "./helpers.js";

test("resolveCommand routes canonical commands", () => {
  assert.deepEqual(resolveCommand(["doctor", "--help", "checks"]), {
    mode: "command",
    command: "doctor",
    args: ["--help", "checks"]
  });
  assert.deepEqual(resolveCommand(["help", "security", "modules"]), {
    mode: "help",
    command: "security",
    args: ["modules"]
  });
});

test("resolveCommand preserves bare mac-bootstrap bootstrap compatibility", () => {
  assert.deepEqual(resolveCommand(["--dry-run"]), {
    mode: "command",
    command: "bootstrap",
    args: ["--dry-run"]
  });
  assert.deepEqual(resolveCommand([]), {
    mode: "command",
    command: "bootstrap",
    args: []
  });
});

test("resolveCommand reports unknown top-level commands", () => {
  assert.deepEqual(resolveCommand(["nope"]), {
    mode: "unknown",
    command: "nope"
  });
});

test("resolveCommand routes the presets and profiles listing commands", () => {
  assert.deepEqual(resolveCommand(["presets"]), { mode: "list", command: "presets" });
  assert.deepEqual(resolveCommand(["profiles"]), { mode: "list", command: "profiles" });
});

test("printRootHelp surfaces preset codenames in a quick-start block", () => {
  const logger = new TestLogger();
  printRootHelp(logger);
  assert.match(logger.text(), /Quick start/);
  assert.match(logger.text(), /scout/);
  assert.match(logger.text(), /maverick/);
  // the new listing commands are advertised in the command list
  assert.match(logger.text(), /presets\s+List the preset codenames/);
  assert.match(logger.text(), /profiles\s+List the package profiles/);
});

test("parseMigrateArgs preserves positional tool arguments", () => {
  const options = parseMigrateArgs(["--apply", "--home", "/tmp/home", "aws", "node"]);
  assert.equal(options.apply, true);
  assert.equal(options.home, "/tmp/home");
  assert.deepEqual(options.tools, ["aws", "node"]);
});

test("parseSecurityArgs preserves dry-run apply semantics and skip validation", () => {
  const options = parseSecurityArgs([
    "--dry-run",
    "--apply",
    "--skip",
    "filevault",
    "--skip=firewall",
    "--ssh-mode",
    "disable"
  ]);
  assert.equal(options.dryRun, true);
  assert.equal(options.apply, true);
  assert.equal(options.sshMode, "disable");
  assert.equal(options.skip.has("filevault"), true);
  assert.equal(options.skip.has("firewall"), true);
});
