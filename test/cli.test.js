import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrateArgs, parseSecurityArgs, resolveCommand } from "../src/cli.js";

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
