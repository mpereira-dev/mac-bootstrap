import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./manifest.js";

// Branded help banner shown at the top of the root help (bare `--help` / `help`).
// Centralized here so the ASCII art lives in one place, matching the sibling CLIs
// (leak-guard, cert-check, gitlab-sync). The wordmark is "MAC BOOTSTRAP" rendered
// in the ANSI Shadow figlet font; the boxed footer carries the version.
const WORDMARK = [
  "███╗   ███╗ █████╗  ██████╗    ██████╗  ██████╗  ██████╗ ████████╗███████╗████████╗██████╗  █████╗ ██████╗ ",
  "████╗ ████║██╔══██╗██╔════╝    ██╔══██╗██╔═══██╗██╔═══██╗╚══██╔══╝██╔════╝╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗",
  "██╔████╔██║███████║██║         ██████╔╝██║   ██║██║   ██║   ██║   ███████╗   ██║   ██████╔╝███████║██████╔╝",
  "██║╚██╔╝██║██╔══██║██║         ██╔══██╗██║   ██║██║   ██║   ██║   ╚════██║   ██║   ██╔══██╗██╔══██║██╔═══╝ ",
  "██║ ╚═╝ ██║██║  ██║╚██████╗    ██████╔╝╚██████╔╝╚██████╔╝   ██║   ███████║   ██║   ██║  ██║██║  ██║██║     ",
  "╚═╝     ╚═╝╚═╝  ╚═╝ ╚═════╝    ╚═════╝  ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     "
];

// Resolve the package version for the banner footer; never throw — the banner is
// decoration, so a missing/garbled package.json just yields a "?" version.
export function bannerVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "?";
  } catch {
    return "?";
  }
}

export function renderBanner(version = bannerVersion()) {
  const INNER = 44; // chars between the box's corner glyphs
  const title = "mac-bootstrap";
  const nodes = "●───●───●───●───●───●───●───●";
  const tagline = "bootstrap • doctor • migrate • secure";
  const dash = (n) => "─".repeat(Math.max(0, n));
  // The wordmark and box stay uncolored — they render in the terminal's default
  // foreground (white), matching the sibling CLIs (leak-guard, cert-check,
  // gitlab-sync), whose banners carry no ANSI at all.
  const row = (text) => ` │${`   ${text}`.padEnd(INNER)}│`;
  const top = ` ┌─ ${title} ${dash(INNER - (title.length + 3))}┐`;
  const vtok = ` v${version} `;
  const right = 7;
  const bottom = ` └${dash(INNER - vtok.length - right)}${vtok}${dash(right)}┘`;
  return ["", ...WORDMARK.map((line) => `  ${line}`), "", top, row(nodes), row(tagline), bottom].join("\n");
}
