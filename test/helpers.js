import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mac-bootstrap-home-"));
}

export function writeSavedSelections(home, profiles) {
  const directory = path.join(home, ".mac-bootstrap");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "profiles.json");
  fs.writeFileSync(file, `${JSON.stringify({ profiles, savedAt: "2026-06-10T00:00:00.000Z" }, null, 2)}\n`);
  return file;
}

export class FakeRunner {
  constructor({
    formulae = [],
    casks = [],
    commands = {},
    failInstall = new Set(),
    failSteps = new Map(),
    xcodeInstalled = true,
    brewInstalled = true,
    nodeVersion = "v24.0.0",
    homebrewPrefix
  } = {}) {
    this.homebrewPrefix = homebrewPrefix || fs.mkdtempSync(path.join(os.tmpdir(), "mac-bootstrap-brew-"));
    this.formulae = new Set(formulae);
    this.casks = new Set(casks);
    this.commands = {
      claude: "1.0.0",
      codex: "1.0.0",
      agy: "1.0.0",
      volta: "2.0.0",
      npm: "10.9.8",
      corepack: "0.34.0",
      uv: "0.5.0",
      poetry: "1.8.0",
      ...commands
    };
    this.failInstall = failInstall;
    this.failSteps = failSteps;
    this.xcodeInstalled = xcodeInstalled;
    this.brewInstalled = brewInstalled;
    this.nodeVersion = nodeVersion;
    this.calls = [];
  }

  run(command, args = [], options = {}) {
    this.calls.push([command, ...args]);
    const joined = [command, ...args].join(" ");
    if (this.failSteps.has(joined)) {
      return { status: 1, stdout: "", stderr: this.failSteps.get(joined) };
    }

    if (command === "xcode-select" && args[0] === "-p") {
      return this.xcodeInstalled
        ? { status: 0, stdout: "/Library/Developer/CommandLineTools\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "not installed" };
    }
    if (command === "xcode-select" && args[0] === "--install") {
      this.xcodeInstalled = true;
      return { status: 0, stdout: "", stderr: "" };
    }

    if (command === "/bin/bash") {
      this.brewInstalled = true;
      return { status: 0, stdout: "", stderr: "" };
    }

    if (command === "corepack" && args[0] === "enable") {
      return { status: 0, stdout: "", stderr: "" };
    }

    if (command === "uv" && args[0] === "python" && args[1] === "install") {
      return { status: 0, stdout: "", stderr: "" };
    }

    if (command.endsWith("/brew")) {
      return this.runBrew(args);
    }

    if (command === "volta" && args[0] === "install") {
      this.nodeVersion = args[1].replace("node@", "v") + ".0.0";
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "volta" && args[0] === "which") {
      return { status: 0, stdout: "/Users/test/.volta/bin/node\n", stderr: "" };
    }
    if (command === "volta" && args[0] === "--version") {
      return { status: 0, stdout: `${this.commands.volta}\n`, stderr: "" };
    }
    if (command === "node" && args[0] === "--version") {
      return { status: 0, stdout: `${this.nodeVersion}\n`, stderr: "" };
    }
    if (command === "npm" && args[0] === "--version") {
      return { status: 0, stdout: `${this.commands.npm}\n`, stderr: "" };
    }
    if (command === "npm" && args[0] === "install" && args[1] === "--global") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "npm" && args[0] === "uninstall" && (args[1] === "-g" || args[1] === "--global")) {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "--version" && this.commands[command]) {
      return { status: 0, stdout: `${this.commands[command]}\n`, stderr: "" };
    }
    if (command === "claude" && args[0] === "update") {
      this.commands.claude = "1.1.0";
      return { status: 0, stdout: "updated\n", stderr: "" };
    }

    return { status: 127, stdout: "", stderr: `${command} not found` };
  }

  runBrew(args) {
    if (args[0] === "list" && args[1] === "--formula" && args[2] === "--versions" && args[3]) {
      return this.formulae.has(args[3])
        ? { status: 0, stdout: `${args[3]} 1.0.0\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "not installed" };
    }
    if (args[0] === "list" && args[1] === "--formula" && args[2]) {
      return this.formulae.has(args[2])
        ? { status: 0, stdout: `${args[2]}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "not installed" };
    }
    if (args[0] === "list" && args[1] === "--versions") {
      return { status: 0, stdout: [...this.formulae].sort().map((name) => `${name} 1.0.0`).join("\n"), stderr: "" };
    }
    if (args[0] === "list" && args[1] === "--cask" && args[2] === "--versions" && args[3]) {
      return this.casks.has(args[3])
        ? { status: 0, stdout: `${args[3]} 1.0.0\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "not installed" };
    }
    if (args[0] === "list" && args[1] === "--cask" && args[2] === "--versions") {
      return { status: 0, stdout: [...this.casks].sort().map((name) => `${name} 1.0.0`).join("\n"), stderr: "" };
    }
    if (args[0] === "list" && args[1] === "--cask" && args[2]) {
      return this.casks.has(args[2])
        ? { status: 0, stdout: `${args[2]}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "not installed" };
    }
    if (args[0] === "install" && args[1] === "--cask") {
      if (this.failInstall.has(args[2])) {
        return { status: 1, stdout: "", stderr: "cask install failed" };
      }
      this.casks.add(args[2]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "install") {
      if (this.failInstall.has(args[1])) {
        return { status: 1, stdout: "", stderr: "formula install failed" };
      }
      this.formulae.add(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "update" || args[0] === "upgrade") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  }
}

export class TestLogger {
  constructor() {
    this.lines = [];
  }

  log(message) {
    this.lines.push(String(message));
  }

  warn(message) {
    this.lines.push(String(message));
  }

  error(message) {
    this.lines.push(String(message));
  }

  text() {
    return this.lines.join("\n");
  }
}
