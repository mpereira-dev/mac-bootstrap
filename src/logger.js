import fs from "node:fs";
import path from "node:path";

const LEVELS = {
  debug: { label: "DEBUG", color: "\x1b[90m" },
  info: { label: "INFO", color: "\x1b[32m" },
  warn: { label: "WARN", color: "\x1b[33m" },
  error: { label: "ERROR", color: "\x1b[31m" }
};

export function formatLogLine(level, message, { color = false } = {}) {
  const config = LEVELS[level] || LEVELS.info;
  const label = `[${config.label}]`;
  const prefix = color ? `${config.color}${label}\x1b[0m` : label;
  return String(message)
    .split(/\r?\n/)
    .map((line) => `${prefix} ${line}`)
    .join("\n");
}

function shouldColor(stream) {
  if (process.env.NO_COLOR) {
    return false;
  }
  return Boolean(process.env.FORCE_COLOR || stream?.isTTY);
}

export class ConsoleLogger {
  constructor({ stdout = process.stdout, stderr = process.stderr, color } = {}) {
    this.stdout = stdout;
    this.stderr = stderr;
    this.color = color;
  }

  debug(message) {
    this.write(this.stdout, "debug", message);
  }

  log(message) {
    this.info(message);
  }

  info(message) {
    this.write(this.stdout, "info", message);
  }

  warn(message) {
    this.write(this.stderr, "warn", message);
  }

  error(message) {
    this.write(this.stderr, "error", message);
  }

  write(stream, level, message) {
    const color = this.color ?? shouldColor(stream);
    stream.write(`${formatLogLine(level, message, { color })}\n`);
  }
}

export class PlainConsoleLogger {
  constructor({ stdout = process.stdout, stderr = process.stderr } = {}) {
    this.stdout = stdout;
    this.stderr = stderr;
  }

  log(message = "") {
    this.stdout.write(`${message}\n`);
  }

  error(message = "") {
    this.stderr.write(`${message}\n`);
  }
}

export class MemoryLogger {
  constructor() {
    this.lines = [];
  }

  debug(message) {
    this.lines.push(formatLogLine("debug", message));
  }

  log(message) {
    this.info(message);
  }

  info(message) {
    this.lines.push(formatLogLine("info", message));
  }

  warn(message) {
    this.lines.push(formatLogLine("warn", message));
  }

  error(message) {
    this.lines.push(formatLogLine("error", message));
  }

  text() {
    return `${this.lines.join("\n")}${this.lines.length ? "\n" : ""}`;
  }
}

export class FileLogger {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  debug(message) {
    this.write("debug", message);
  }

  log(message) {
    this.info(message);
  }

  info(message) {
    this.write("info", message);
  }

  warn(message) {
    this.write("warn", message);
  }

  error(message) {
    this.write("error", message);
  }

  write(level, message) {
    fs.appendFileSync(this.filePath, `${new Date().toISOString()} ${formatLogLine(level, message)}\n`);
  }
}
