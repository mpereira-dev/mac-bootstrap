import assert from "node:assert/strict";
import test from "node:test";
import { ConsoleLogger, FileLogger, MemoryLogger, formatLogLine } from "../src/logger.js";
import { tempHome } from "./helpers.js";
import fs from "node:fs";
import path from "node:path";

function stream() {
  return {
    text: "",
    write(chunk) {
      this.text += chunk;
    }
  };
}

test("formatLogLine prefixes every message line", () => {
  assert.equal(formatLogLine("info", "one\ntwo"), "[INFO] one\n[INFO] two");
});

test("ConsoleLogger sends colored info to stdout and warnings/errors to stderr", () => {
  const stdout = stream();
  const stderr = stream();
  const logger = new ConsoleLogger({ stdout, stderr, color: true });

  logger.debug("trace");
  logger.info("ready");
  logger.warn("check this");
  logger.error("failed");

  assert.match(stdout.text, /\x1b\[90m\[DEBUG\]\x1b\[0m trace/);
  assert.match(stdout.text, /\x1b\[32m\[INFO\]\x1b\[0m ready/);
  assert.match(stderr.text, /\x1b\[33m\[WARN\]\x1b\[0m check this/);
  assert.match(stderr.text, /\x1b\[31m\[ERROR\]\x1b\[0m failed/);
});

test("MemoryLogger and FileLogger keep structured labels without ANSI color", () => {
  const memory = new MemoryLogger();
  memory.log("stored");
  memory.error("bad");
  assert.match(memory.text(), /\[INFO\] stored/);
  assert.match(memory.text(), /\[ERROR\] bad/);

  const logPath = path.join(tempHome(), "Library", "Logs", "test.log");
  const file = new FileLogger(logPath);
  file.warn("watch");
  assert.match(fs.readFileSync(logPath, "utf8"), /\[WARN\] watch/);
});
