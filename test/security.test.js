import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as security from "../src/security/index.js";
import * as filevault from "../src/security/filevault.js";
import * as firewall from "../src/security/firewall.js";
import * as ssh from "../src/security/ssh-hardening.js";

// Stub runner — records calls and returns scripted responses.
function makeRunner(responses = {}) {
  const calls = [];
  return {
    calls,
    async run(cmd, args = []) {
      const key = `${cmd} ${args.join(" ")}`.trim();
      calls.push(key);
      const match = Object.entries(responses).find(([prefix]) => key.startsWith(prefix));
      if (!match) return { exitCode: 0, stdout: "", stderr: "" };
      return match[1];
    },
  };
}

describe("filevault module", () => {
  it("detect: parses 'FileVault is On'", async () => {
    const runner = makeRunner({ "fdesetup status": { exitCode: 0, stdout: "FileVault is On.\n", stderr: "" } });
    const r = await filevault.detect({ runner });
    assert.equal(r.ok, true);
    assert.equal(r.enabled, true);
  });

  it("detect: parses 'FileVault is Off'", async () => {
    const runner = makeRunner({ "fdesetup status": { exitCode: 0, stdout: "FileVault is Off.\n", stderr: "" } });
    const r = await filevault.detect({ runner });
    assert.equal(r.enabled, false);
  });

  it("suggest: returns no-action when enabled", async () => {
    const r = await filevault.suggest({ current: { ok: true, enabled: true } });
    assert.match(r.advice, /no action/i);
  });

  it("suggest: includes recovery-key + reboot-gotcha notes when off", async () => {
    const r = await filevault.suggest({ current: { ok: true, enabled: false } });
    assert.match(r.command, /sudo fdesetup enable/);
    assert.ok(r.notes.some((n) => /recovery key/i.test(n)));
    assert.ok(r.notes.some((n) => /LaunchAgent/i.test(n)));
  });

  it("apply: noop when already enabled", async () => {
    const runner = makeRunner({ "fdesetup status": { exitCode: 0, stdout: "FileVault is On.", stderr: "" } });
    const r = await filevault.apply({ runner, logger: { log() {} } });
    assert.equal(r.changed, false);
  });

  it("apply: never auto-enables (interactive sudo + recovery key capture too risky)", async () => {
    const runner = makeRunner({ "fdesetup status": { exitCode: 0, stdout: "FileVault is Off.", stderr: "" } });
    const r = await filevault.apply({ runner, logger: { log() {} } });
    assert.equal(r.changed, false);
    assert.equal(r.manualStep, "sudo fdesetup enable");
  });
});

describe("firewall module", () => {
  it("detect: enabled + stealth on", async () => {
    const runner = makeRunner({
      "/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate": {
        exitCode: 0, stdout: "Firewall is enabled. (State = 1)", stderr: "",
      },
      "/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode": {
        exitCode: 0, stdout: "Stealth mode enabled", stderr: "",
      },
    });
    const r = await firewall.detect({ runner });
    assert.equal(r.enabled, true);
    assert.equal(r.stealth, true);
  });

  it("suggest: recommends enabling both when off", async () => {
    const r = await firewall.suggest({ current: { ok: true, enabled: false, stealth: false } });
    assert.ok(r.commands.some((c) => /globalstate/.test(c)));
    assert.ok(r.commands.some((c) => /stealthmode/.test(c)));
    assert.ok(r.notes.some((n) => /loopback/i.test(n)));
    assert.ok(r.notes.some((n) => /setblockall/i.test(n)));
  });

  it("suggest: noop when both already on", async () => {
    const r = await firewall.suggest({ current: { ok: true, enabled: true, stealth: true } });
    assert.match(r.advice, /no action/i);
  });

  it("apply: dry-run logs planned commands", async () => {
    const runner = makeRunner({
      "/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate": { exitCode: 0, stdout: "disabled", stderr: "" },
      "/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode": { exitCode: 0, stdout: "disabled", stderr: "" },
    });
    const logs = [];
    const r = await firewall.apply({ runner, logger: { log: (m) => logs.push(m) }, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.ok(logs.some((l) => /DRY RUN/.test(l)));
  });
});

describe("ssh-hardening module", () => {
  it("detect: Remote Login off → no action recommended", async () => {
    const runner = makeRunner({
      "systemsetup -getremotelogin": { exitCode: 0, stdout: "Remote Login: Off\n", stderr: "" },
      "/bin/cat /etc/ssh/sshd_config.d/99-mac-bootstrap.conf": { exitCode: 1, stdout: "", stderr: "No such file" },
    });
    const current = await ssh.detect({ runner });
    assert.equal(current.remoteLoginOn, false);
    const r = await ssh.suggest({ current });
    assert.match(r.advice, /no SSH attack surface/i);
  });

  it("detect: Remote Login on + drop-in matches → OK", async () => {
    const runner = makeRunner({
      "systemsetup -getremotelogin": { exitCode: 0, stdout: "Remote Login: On\n", stderr: "" },
      "/bin/cat /etc/ssh/sshd_config.d/99-mac-bootstrap.conf": { exitCode: 0, stdout: ssh.HARDENING_CONFIG, stderr: "" },
    });
    const current = await ssh.detect({ runner });
    assert.equal(current.remoteLoginOn, true);
    assert.equal(current.dropInMatches, true);
    const r = await ssh.suggest({ current });
    assert.match(r.advice, /OK/);
  });

  it("suggest: Remote Login on + no drop-in → offers both disable + harden options", async () => {
    const r = await ssh.suggest({ current: { remoteLoginOn: true, dropInExists: false, dropInMatches: false } });
    assert.equal(r.options.length, 2);
    assert.match(r.options[0].command, /systemsetup -setremotelogin off/);
    assert.ok(r.options[1].commands.some((c) => /sshd -t/.test(c)));
  });

  it("hardening config: contains key directives", () => {
    assert.match(ssh.HARDENING_CONFIG, /PasswordAuthentication no/);
    assert.match(ssh.HARDENING_CONFIG, /PermitRootLogin no/);
    assert.match(ssh.HARDENING_CONFIG, /MaxAuthTries 3/);
    assert.match(ssh.HARDENING_CONFIG, /PubkeyAuthentication yes/);
  });

  it("apply mode=disable: when already off, noop", async () => {
    const runner = makeRunner({
      "systemsetup -getremotelogin": { exitCode: 0, stdout: "Remote Login: Off\n", stderr: "" },
      "/bin/cat ": { exitCode: 1, stdout: "", stderr: "no such file" },
    });
    const r = await ssh.apply({ runner, logger: { log() {} }, mode: "disable" });
    assert.equal(r.changed, false);
  });
});

describe("security/index aggregator", () => {
  it("exports the three modules", () => {
    assert.equal(security.MODULES.length, 3);
    assert.ok(security.MODULES.find((m) => m.name === "filevault"));
    assert.ok(security.MODULES.find((m) => m.name === "firewall"));
    assert.ok(security.MODULES.find((m) => m.name === "ssh-hardening"));
  });

  it("detectAll runs all three", async () => {
    const runner = makeRunner({
      "fdesetup status": { exitCode: 0, stdout: "FileVault is On.", stderr: "" },
      "/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate": { exitCode: 0, stdout: "Firewall is enabled.", stderr: "" },
      "/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode": { exitCode: 0, stdout: "Stealth mode enabled", stderr: "" },
      "systemsetup -getremotelogin": { exitCode: 0, stdout: "Remote Login: Off", stderr: "" },
      "/bin/cat ": { exitCode: 1, stdout: "", stderr: "no such file" },
    });
    const states = await security.detectAll({ runner });
    assert.equal(states.filevault.enabled, true);
    assert.equal(states.firewall.enabled, true);
    assert.equal(states["ssh-hardening"].remoteLoginOn, false);
  });
});
