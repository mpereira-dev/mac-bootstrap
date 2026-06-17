import { spawnSync } from "node:child_process";

export class CommandRunner {
  constructor({ dryRun = false, logger = console, env = process.env } = {}) {
    this.dryRun = dryRun;
    this.logger = logger;
    this.env = env;
  }

  run(command, args = [], options = {}) {
    const printable = formatCommand(command, args);
    if (this.dryRun) {
      this.logger.log(`[dry-run] ${printable}`);
      return { status: 0, exitCode: 0, stdout: "", stderr: "", dryRun: true };
    }

    const result = spawnSync(command, args, {
      encoding: "utf8",
      env: { ...this.env, ...(options.env ?? {}) },
      cwd: options.cwd,
      input: options.input,
      timeout: options.timeoutMs
    });

    if (result.error) {
      const status = result.error.code === "ENOENT" ? 127 : result.error.code === "ETIMEDOUT" ? 124 : 1;
      return {
        status,
        exitCode: status,
        stdout: result.stdout ?? "",
        stderr: result.error.code === "ETIMEDOUT"
          ? `timed out after ${options.timeoutMs}ms`
          : result.stderr ? result.stderr : result.error.message,
        error: result.error
      };
    }

    const status = result.status ?? 0;
    return {
      status,
      exitCode: status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }
}

export function formatCommand(command, args = []) {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\\''")}'`;
}
