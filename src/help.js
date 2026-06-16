import { loadManifest } from "./manifest.js";
import { packagesForProfile } from "./prompt.js";

// --- small presentation helpers ---------------------------------------------

// Bin name a topic path is reached through, used in the "run this for detail"
// footer so copy/paste works regardless of which command you are in.
const BIN = {
  bootstrap: "mac-bootstrap",
  doctor: "mac-bootstrap-doctor",
  nightly: "mac-bootstrap-nightly",
  migrate: "mac-bootstrap-migrate"
};

function leaf(name) {
  const parts = String(name).split("/");
  return parts[parts.length - 1];
}

// Render an aligned box-drawing table from a header row and string rows. Column
// widths size to content; nothing wraps, so keep cells reasonable.
export function renderTable(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => String(row[column]).length))
  );
  const rule = (left, mid, right) =>
    left + widths.map((width) => "─".repeat(width + 2)).join(mid) + right;
  const line = (cells) =>
    "│" + cells.map((cell, column) => ` ${String(cell).padEnd(widths[column])} `).join("│") + "│";

  return [
    rule("┌", "┬", "┐"),
    line(headers),
    rule("├", "┼", "┤"),
    ...rows.map(line),
    rule("└", "┴", "┘")
  ].join("\n");
}

// The pretty profile table used in `bootstrap --help profiles`.
export function renderProfileTable(manifest) {
  const names = Object.keys(manifest.profiles || {});
  const rows = names.map((name) => {
    const def = manifest.profiles[name] || {};
    const packages = packagesForProfile(manifest, name).map(leaf);
    if (name === "node") {
      packages.push("corepack");
    }
    return [
      name,
      def.defaultEnabled ? "on" : "off",
      packages.join(", ") || "(none)"
    ];
  });
  return renderTable(["Profile", "Default", "Packages"], rows);
}

// The preset (codename) table used in `bootstrap --help presets`.
export function renderPresetTable(manifest) {
  const presets = manifest.presets || {};
  const rows = Object.keys(presets).map((name) => [
    name,
    (presets[name].profiles || []).join(", "),
    presets[name].description || ""
  ]);
  return renderTable(["Preset", "Profiles", "Purpose"], rows);
}

// --- help content tree -------------------------------------------------------
//
// Each node: { summary, usage?, body?(ctx)->string, topics?: { name: node } }.
// Topics nest arbitrarily deep; the printer walks the path it is given.

const TREES = {
  bootstrap: {
    summary: "Install the owner-approved baseline on an Apple Silicon macOS laptop.",
    usage: "mac-bootstrap [--dry-run] [--yes] [--reconfigure] [--preset NAME] [--profiles=A,B] [--home PATH] [--packages PATH]",
    body: () =>
      [
        "Idempotent: a re-run installs only what is missing, so it is safe to run",
        "repeatedly. Use --dry-run first to print the plan without touching anything.",
        "",
        "Steps: Xcode CLI tools, Homebrew, enabled formulae + casks, Volta-managed",
        "Node, Corepack, a minimal ~/.zshrc baseline, and the LaunchAgents/Logs dirs."
      ].join("\n"),
    topics: {
      profiles: {
        summary: "What profiles exist and which install by default.",
        body: (ctx) =>
          [
            renderProfileTable(ctx.manifest),
            "",
            "Default = installed on a plain `--yes` run. Every profile is offered in",
            "the interactive picker; off-by-default ones just start unchecked.",
            "Your choice is saved to ~/.mac-bootstrap/profiles.json and reused after.",
            "",
            "Prefer a one-word codename? See `--help presets`."
          ].join("\n"),
        topics: {
          selection: {
            summary: "How a selection is chosen, saved, and changed.",
            body: () =>
              [
                "Selection priority, highest first:",
                "  1. --preset NAME    expand a codename to its profiles, no prompt (saved)",
                "  2. --profiles=A,B   exactly these, no prompt (saved)",
                "  3. saved file       ~/.mac-bootstrap/profiles.json (unless --reconfigure)",
                "  4. --yes            saved selection, or manifest defaults if none saved",
                "  5. (none)           prompt once interactively, then save",
                "",
                "Re-run with --reconfigure to be prompted again. Delete the saved file",
                "to start clean. doctor and nightly read this same file."
              ].join("\n")
          }
        }
      },
      presets: {
        summary: "One-word codenames that expand to a set of profiles.",
        body: (ctx) =>
          [
            renderPresetTable(ctx.manifest),
            "",
            "Use one with --preset, e.g. `mac-bootstrap --preset ranger`. A preset",
            "behaves like --profiles: it skips the prompt and saves the selection, so",
            "you get the same laptop with one word on every machine.",
            "Edit the `presets` block in packages.json to rename or add your own."
          ].join("\n")
      },
      corepack: {
        summary: "Per-project pnpm/yarn versions, no global install.",
        body: () =>
          [
            "When the node profile is on, bootstrap runs `corepack enable`. Corepack",
            "ships with Node and provisions the exact pnpm/yarn each project pins in",
            'its package.json "packageManager" field (e.g. "pnpm@10.18.0").',
            "",
            "So different repos use different pnpm versions with no conflict, and you",
            "never install pnpm globally. A standalone global pnpm shows up as MIGRATE",
            "in `mac-bootstrap-migrate`."
          ].join("\n")
      },
      examples: {
        summary: "Common invocations.",
        body: () =>
          [
            "  mac-bootstrap --dry-run            preview everything, change nothing",
            "  mac-bootstrap                      first run: prompt, then install",
            "  mac-bootstrap --yes                non-interactive, use saved/defaults",
            "  mac-bootstrap --preset ranger      a codename → its profile set",
            "  mac-bootstrap --profiles=core,node,cloud   exactly these",
            "  mac-bootstrap --reconfigure        re-pick profiles from scratch"
          ].join("\n")
      }
    }
  },

  doctor: {
    summary: "Verify the laptop matches the expected baseline; exit non-zero on drift.",
    usage: "mac-bootstrap-doctor [--dry-run] [--home PATH] [--packages PATH]",
    body: () => "Only the currently-enabled profiles are checked (saved selection, or defaults).",
    topics: {
      checks: {
        summary: "Everything doctor verifies.",
        body: () =>
          [
            "  • ~/Library/LaunchAgents and ~/Library/Logs exist",
            "  • the launchd nightly plist template is present in the repo",
            "  • the launchd job is loaded (only if you installed the plist)",
            "  • ~/.zshrc carries the mac-bootstrap managed baseline block",
            "  • Xcode CLI tools are installed",
            "  • every enabled formula and cask is installed",
            "  • each enabled cask command answers --version",
            "  • Volta, Node (expected major), and Corepack (node profile only)"
          ].join("\n")
      },
      "exit-codes": {
        summary: "What the exit status means.",
        body: () => "  0  everything matches\n  1  at least one check failed (drift)"
      }
    }
  },

  nightly: {
    summary: "Unattended Homebrew + self-update maintenance, designed for launchd.",
    usage: "mac-bootstrap-nightly [--dry-run] [--home PATH] [--packages PATH]",
    topics: {
      steps: {
        summary: "What the nightly job runs.",
        body: () =>
          [
            "  brew update / upgrade / upgrade --cask",
            "  per-cask self-updates (e.g. `claude update`) for enabled profiles only",
            "  npm-global installs, if packages.json pins any",
            "",
            "It captures before/after versions, writes to",
            "~/Library/Logs/mac-bootstrap-nightly.log, and rotates logs (7-day retention)."
          ].join("\n")
      },
      launchd: {
        summary: "How to install the nightly schedule.",
        body: () =>
          [
            "The repo ships a template at launchd/com.mac-bootstrap.nightly.plist but does",
            "NOT load it. After reviewing it:",
            "",
            "  cp launchd/com.mac-bootstrap.nightly.plist ~/Library/LaunchAgents/",
            "  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mac-bootstrap.nightly.plist",
            "",
            "doctor then verifies the job is loaded."
          ].join("\n")
      },
      discord: {
        summary: "Optional Discord summary.",
        body: () =>
          "A summary is posted only when DISCORD_WEBHOOK_URL is set in the environment. No webhook, no post."
      }
    }
  },

  migrate: {
    summary: "Find tools installed the wrong way and move them onto managed installs.",
    usage: "mac-bootstrap-migrate [--apply] [--home PATH] [--packages PATH] [tool ...]",
    body: () =>
      [
        "Plan-only by default — it prints what would change and touches nothing.",
        "Add --apply to execute (the flag is your confirmation; no extra prompts).",
        "With no tool arguments it audits the default set: brew pnpm aws cdk node."
      ].join("\n"),
    topics: {
      detection: {
        summary: "How a tool's installer is identified.",
        body: () =>
          [
            "For each tool name (via tools/provenance.sh):",
            "  1. resolve it on PATH (`command -v`), noting aliases/builtins",
            "  2. follow the symlink chain to the real binary",
            "  3. bucket the real path by location to name the owning manager:",
            "       /opt/homebrew/...     Homebrew formula or cask (confirmed via brew list)",
            "       ~/Library/pnpm/...    standalone pnpm, a pnpm global, or pnpm-env Node",
            "       ~/.volta/...          Volta-managed",
            "       a pkgutil receipt     a macOS .pkg install",
            "       npm global bin        an `npm i -g` install",
            "       ~/.local/bin, pipx    a user Python install",
            "       /usr/bin, /bin, ...   OS-provided (left alone)",
            "       anything else         a manual copy of unknown origin"
          ].join("\n")
      },
      verdicts: {
        summary: "OK / MIGRATE / UNMANAGED.",
        body: () =>
          [
            "  OK         the manifest manages it AND it is installed the managed way",
            "  MIGRATE    the manifest manages it but it was installed another way",
            "  UNMANAGED  the manifest does not list it (keep, adopt, or remove by hand)",
            "",
            "Only MIGRATE tools are acted on."
          ].join("\n")
      },
      removal: {
        summary: "How old copies are removed — and when they are not.",
        body: () =>
          [
            "Per MIGRATE tool:",
            "  1. install the managed version first (brew/Volta) — idempotent, low risk",
            "  2. only if that succeeds, remove the old copy",
            "",
            "Removal is auto-run ONLY for clean commands (e.g. `npm uninstall -g aws`).",
            "Anything with a version placeholder, a `.pkg` receipt, or a manual drop is",
            "PRINTED for you to handle — never run automatically. Running --apply is the",
            "confirmation; there is no second prompt."
          ].join("\n")
      }
    }
  }
};

// --- printer -----------------------------------------------------------------

function listTopics(node, command, trail, logger) {
  const topics = node.topics || {};
  const names = Object.keys(topics);
  if (names.length === 0) {
    return;
  }
  logger.log("");
  logger.log("More help:");
  const width = Math.max(...names.map((name) => name.length));
  for (const name of names) {
    logger.log(`  ${name.padEnd(width)}   ${topics[name].summary}`);
  }
  const path = trail.slice(1).concat("<topic>").join(" ");
  logger.log("");
  logger.log(`Run \`${BIN[command]} --help ${path}\` for any topic above.`);
}

// Print help for a command, walking `topicPath` into the nested topic tree.
// `ctx.manifest` feeds dynamic bodies (the profile table); it is loaded lazily.
export function printHelp(command, topicPath = [], { manifest, logger = console } = {}) {
  const root = TREES[command];
  if (!root) {
    logger.error(`No help for "${command}".`);
    return 1;
  }
  const ctx = { manifest: manifest || loadManifest() };

  let node = root;
  const trail = [command];
  for (const segment of topicPath) {
    const next = node.topics && node.topics[segment];
    if (!next) {
      logger.error(`Unknown help topic: ${[...trail.slice(1), segment].join(" ")}`);
      logger.log(`Available under ${trail.join(" ")}: ${Object.keys(node.topics || {}).join(", ") || "(none)"}`);
      return 1;
    }
    node = next;
    trail.push(segment);
  }

  logger.log(trail.join(" › "));
  logger.log(node.summary);
  if (node.usage) {
    logger.log("");
    logger.log(`Usage: ${node.usage}`);
  }
  if (typeof node.body === "function") {
    logger.log("");
    logger.log(node.body(ctx));
  }
  listTopics(node, command, trail, logger);
  return 0;
}
