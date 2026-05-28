import fs from "node:fs";
import path from "node:path";

export class MemoryLogger {
  constructor() {
    this.lines = [];
  }

  log(message) {
    this.lines.push(String(message));
  }

  error(message) {
    this.lines.push(String(message));
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

  log(message) {
    fs.appendFileSync(this.filePath, `${new Date().toISOString()} ${message}\n`);
  }

  error(message) {
    this.log(`ERROR ${message}`);
  }
}
