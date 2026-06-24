import { colorize, heading, resolveUseColor } from "./colors.js";
import { loadManifest } from "./manifest.js";
import { packagesForProfile } from "./prompt.js";

// --- small presentation helpers ---------------------------------------------

// Bin name a topic path is reached through, used in the "run this for detail"
// footer so copy/paste works regardless of which command you are in.
const BIN = {
  bootstrap: "mac-bootstrap bootstrap",
  doctor: "mac-bootstrap doctor",
  nightly: "mac-bootstrap nightly",
  migrate: "mac-bootstrap migrate",
  security: "mac-bootstrap security"
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

// Compact `name  purpose` lines for the root-help quick-start teaser. Returns []
// when the manifest declares no presets, so callers can omit the section.
export function presetLines(manifest, useColor = resolveUseColor(undefined, process.stdout)) {
  const presets = manifest.presets || {};
  const names = Object.keys(presets);
  if (names.length === 0) {
    return [];
  }
  const width = Math.max(...names.map((name) => name.length));
  return names.map((name) => {
    const def = presets[name] || {};
    const detail = def.description || (def.profiles || []).join(", ");
    return `  ${colorize(name.padEnd(width), "cyan", useColor)}  ${detail}`;
  });
}

// Standalone `mac-bootstrap presets` listing — the same table as the help topic
// but reachable without the --help ceremony, so codenames are discoverable.
export function printPresets({ manifest, logger = console } = {}) {
  const resolved = manifest || loadManifest();
  const useColor = resolveUseColor(undefined, process.stdout);
  logger.log(heading("Presets", useColor) + " — one word that expands to a full profile set:");
  logger.log("");
  logger.log(renderPresetTable(resolved));
  logger.log("");
  logger.log("Apply one (skips the prompt, saves the selection):");
  const first = Object.keys(resolved.presets || {})[0] || "scout";
  logger.log(`  ${colorize(`mac-bootstrap bootstrap --preset ${first}`, "cyan", useColor)}`);
  logger.log("");
  logger.log("List the underlying groups with `mac-bootstrap profiles`.");
  return 0;
}

// Standalone `mac-bootstrap profiles` listing — companion to printPresets.
export function printProfiles({ manifest, logger = console } = {}) {
  const resolved = manifest || loadManifest();
  const useColor = resolveUseColor(undefined, process.stdout);
  logger.log(heading("Profiles", useColor) + " — package groups you can toggle (Default = on for a plain --yes run):");
  logger.log("");
  logger.log(renderProfileTable(resolved));
  logger.log("");
  logger.log("Enable an exact set:  mac-bootstrap bootstrap --profiles=core,node,cloud");
  logger.log("Prefer a one-word codename? Run `mac-bootstrap presets`.");
  return 0;
}

// --- help content tree -------------------------------------------------------
//
// Each node: { summary, usage?, body?(ctx)->string, topics?: { name: node } }.
// Topics nest arbitrarily deep; the printer walks the path it is given.

const TREES = {
  bootstrap: {
    summary: "Install the owner-approved baseline on an Apple Silicon macOS laptop.",
    usage: "mac-bootstrap bootstrap [--dry-run] [--yes] [--reconfigure] [--preset NAME] [--profiles=A,B] [--home PATH] [--packages PATH]",
    body: () =>
      [
        "Idempotent: a re-run installs only what is missing, so it is safe to run",
        "repeatedly. Use --dry-run first to print the plan without touching anything.",
        "",
        "Steps: Xcode CLI tools, Homebrew, enabled formulae + casks, Volta-managed",
        "Node, Corepack, a minimal ~/.zshrc baseline (PATH adds ~/.volta/bin then",
        "~/.local/bin for user-managed CLI launchers), and the LaunchAgents/Logs dirs."
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
            "List them anytime with `mac-bootstrap profiles` (no --help needed).",
            "",
            "Prefer a one-word codename? See `--help presets` or `mac-bootstrap presets`."
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
            "Use one with --preset, e.g. `mac-bootstrap bootstrap --preset ranger`. A preset",
            "behaves like --profiles: it skips the prompt and saves the selection, so",
            "you get the same laptop with one word on every machine.",
            "List them anytime with `mac-bootstrap presets` (no --help needed).",
            "Edit the `presets` block in packages.json to rename or add your own."
          ].join("\n")
      },
      corepack: {
        summary: "Per-project pnpm/yarn versions, no global install.",
        body: () =>
          [
            "When the node profile is on, bootstrap runs `volta install corepack`",
            "(so the shim lands on PATH) then `corepack enable`. Corepack ships with",
            "Node and provisions the exact pnpm/yarn each project pins in",
            'its package.json "packageManager" field (e.g. "pnpm@10.18.0").',
            "",
            "So different repos use different pnpm versions with no conflict, and you",
            "never install pnpm globally. A standalone global pnpm shows up as MIGRATE",
            "in `mac-bootstrap migrate`."
          ].join("\n")
      },
      examples: {
        summary: "Common invocations.",
        body: () =>
          [
            "  mac-bootstrap bootstrap --dry-run            preview everything, change nothing",
            "  mac-bootstrap bootstrap                      first run: prompt, then install",
            "  mac-bootstrap bootstrap --yes                non-interactive, use saved/defaults",
            "  mac-bootstrap bootstrap --preset ranger      a codename -> its profile set",
            "  mac-bootstrap bootstrap --profiles=core,node,cloud   exactly these",
            "  mac-bootstrap bootstrap --reconfigure        re-pick profiles from scratch"
          ].join("\n")
      },
      flags: {
        summary: "All bootstrap flags.",
        body: () =>
          [
            "  --dry-run          print the plan, do not install",
            "  --yes, -y          non-interactive; use saved selection or defaults",
            "  --reconfigure     ignore saved profiles and prompt again",
            "  --preset NAME     expand a preset and save the resulting profiles",
            "  --profiles=A,B    install exactly these profiles and save them",
            "  --home PATH       use a different HOME for config files",
            "  --packages PATH   load a different packages.json manifest",
            "  --help [topic]    show this help tree"
          ].join("\n")
      },
      "exit-codes": {
        summary: "What the exit status means.",
        body: () =>
          [
            "  0  bootstrap completed, or dry-run/help printed successfully",
            "  1  argument, prompt, install, or filesystem failure",
            "  2  network is unavailable before install work begins"
          ].join("\n")
      }
    }
  },

  doctor: {
    summary: "Verify the laptop matches the expected baseline; exit non-zero on drift.",
    usage: "mac-bootstrap doctor [--dry-run] [--home PATH] [--packages PATH]",
    body: () => "Only the currently-enabled profiles are checked (saved selection, or defaults).",
    topics: {
      checks: {
        summary: "Everything doctor verifies.",
        body: () =>
          [
            "  • ~/Library/LaunchAgents and ~/Library/Logs exist",
            "  • ~/.local/bin/mac-bootstrap launcher is present and executable",
            "  • the launchd nightly plist template is present in the repo",
            "  • the launchd job is loaded (only if you installed the plist)",
            "  • ~/.zshrc carries the mac-bootstrap managed baseline block",
            "  • Xcode CLI tools are installed",
            "  • every enabled formula is installed",
            "  • CLI casks answer through their usable command (claude/codex/agy)",
            "  • GUI casks without commands have an installed Homebrew cask receipt",
            "  • enabled Homebrew Casks do not carry quarantined nested helper binaries",
            "  • Volta, Node (expected major), and Corepack (node profile only)"
          ].join("\n")
      },
      profiles: {
        summary: "Which profiles doctor checks.",
        body: () =>
          [
            "doctor reads the same saved profile selection as bootstrap:",
            "  ~/.mac-bootstrap/profiles.json",
            "",
            "If no saved selection exists, doctor checks manifest defaults. Use",
            "`mac-bootstrap bootstrap --profiles=...` or `mac-bootstrap bootstrap --preset ...` to set",
            "the laptop profile set doctor and nightly should enforce."
          ].join("\n")
      },
      "exit-codes": {
        summary: "What the exit status means.",
        body: () => "  0  everything matches\n  1  at least one check failed (drift)"
      },
      fixes: {
        summary: "How to respond when doctor reports drift.",
        body: () =>
          [
            "Start with the failing line:",
            "  • missing formula/cask: run `mac-bootstrap bootstrap --profiles=...` or `brew install ...`",
            "  • wrong Node major: run `volta install node@24` from the node profile",
            "  • missing Corepack: run `volta install corepack` then `corepack enable`",
            "  • quarantined cask helper: run targeted `mac-bootstrap security --apply` with skips as needed",
            "  • missing zsh baseline: run `mac-bootstrap bootstrap` once for this HOME",
            "  • missing/non-executable launcher: run `mac-bootstrap bootstrap` to self-register ~/.local/bin/mac-bootstrap",
            "  • launchd job missing: install the plist only after reviewing the template",
            "",
            "Use `mac-bootstrap doctor --dry-run` to see the check plan without invoking tools."
          ].join("\n")
      }
    }
  },

  nightly: {
    summary: "Unattended Homebrew + self-update maintenance, designed for launchd.",
    usage: "mac-bootstrap nightly [--dry-run] [--home PATH] [--packages PATH]",
    topics: {
      steps: {
        summary: "What the nightly job runs.",
        body: () =>
          [
            "  brew update / upgrade / upgrade --cask",
            "  strip quarantine from nested Homebrew Cask helper binaries",
            "  per-cask self-updates (e.g. `claude update`) for enabled profiles only",
            "  npm-global updates, if packages.json pins any",
            "",
            "It captures before/after versions, writes to",
            "~/Library/Logs/mac-bootstrap-nightly.log, and rotates logs (7-day retention)."
          ].join("\n")
      },
      launchd: {
        summary: "How to install the nightly schedule.",
        body: () =>
          [
            "The repo ships a template at launchd/com.mac-bootstrap.nightly.plist.",
            "To install it, generating the correct absolute paths dynamically:",
            "",
            "  mac-bootstrap nightly --install",
            "",
            "This command writes the configured plist to ~/Library/LaunchAgents/ and",
            "loads it into launchd. doctor then verifies the job is loaded."
          ].join("\n")
      },
      discord: {
        summary: "Optional Discord summary.",
        body: () =>
          "A summary is posted only when DISCORD_WEBHOOK_URL is set in the environment. No webhook, no post."
      },
      logs: {
        summary: "Where nightly writes logs and snapshots.",
        body: () =>
          [
            "Nightly writes the active log to:",
            "  ~/Library/Logs/mac-bootstrap-nightly.log",
            "",
            "Before/after version snapshots are captured during the run so the Discord",
            "summary can report what changed. Old logs are rotated with seven-day retention."
          ].join("\n")
      },
      "exit-codes": {
        summary: "What the exit status means.",
        body: () =>
          [
            "  0  maintenance completed, or dry-run/help printed successfully",
            "  1  one or more maintenance commands failed",
            "  2  network is unavailable before maintenance begins"
          ].join("\n")
      }
    }
  },

  migrate: {
    summary: "Find tools installed the wrong way and move them onto managed installs.",
    usage: "mac-bootstrap migrate [--apply] [--home PATH] [--packages PATH] [tool ...]",
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
      tools: {
        summary: "Default and positional tool selection.",
        body: () =>
          [
            "With no positional tools, migrate audits:",
            "  brew pnpm aws cdk node",
            "",
            "Pass tool names to narrow the run:",
            "  mac-bootstrap migrate aws node",
            "",
            "Tool names are command names, not always package names. The manifest maps",
            "commands like `aws`, `cdk`, and `terraform` back to their managed formula."
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
      },
      examples: {
        summary: "Common migrate invocations.",
        body: () =>
          [
            "  mac-bootstrap migrate                 audit default tools, change nothing",
            "  mac-bootstrap migrate aws node        audit only AWS CLI + Node",
            "  mac-bootstrap migrate --apply aws     install managed AWS CLI, then remove old copy",
            "  mac-bootstrap migrate --help removal  explain safety rules"
          ].join("\n")
      }
    }
  },

  security: {
    summary: "Detect and optionally apply local macOS security hardening.",
    usage: "mac-bootstrap security [--apply] [--dry-run] [--skip MODULE] [--ssh-mode harden|disable]",
    body: () =>
      [
        "Default mode is read-only: detect current state, print suggested actions,",
        "and exit without changing the machine. Add --apply to execute automated",
        "steps. FileVault enablement remains a manual step because it requires",
        "interactive sudo and recovery-key capture."
      ].join("\n"),
    topics: {
      modules: {
        summary: "The security checks this command owns.",
        body: () =>
          [
            "  filevault       disk-at-rest encryption for laptop theft",
            "  firewall        macOS Application Firewall + stealth mode",
            "  ssh-hardening   Remote Login off, or hardened sshd config if SSH stays on",
            "  cask-quarantine targeted Gatekeeper quarantine cleanup for nested Cask helpers",
            "",
            "Run with `--skip MODULE` to omit a module during apply."
          ].join("\n")
      },
      filevault: {
        summary: "Disk encryption check and manual enablement guidance.",
        body: () =>
          [
            "Detects `fdesetup status` and suggests `sudo fdesetup enable` when off.",
            "The command does not auto-enable FileVault because the recovery key must",
            "be captured immediately and stored safely.",
            "",
            "Operational gotcha: after reboot, LaunchAgents do not run until the first",
            "interactive login unlocks FileVault. For planned remote reboots, use",
            "`sudo fdesetup authrestart` when appropriate."
          ].join("\n")
      },
      firewall: {
        summary: "Application Firewall and stealth-mode hardening.",
        body: () =>
          [
            "Detects global firewall state and stealth mode via socketfilterfw.",
            "Apply enables both when needed:",
            "  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on",
            "  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on",
            "",
            "It intentionally avoids `--setblockall` because that breaks Bonjour,",
            "AirDrop, and local development access."
          ].join("\n")
      },
      "ssh-hardening": {
        summary: "Remote Login policy and sshd drop-in hardening.",
        body: () =>
          [
            "Preferred policy is Remote Login off:",
            "  mac-bootstrap security --apply --ssh-mode disable",
            "",
            "If SSH must stay on, default apply mode writes:",
            "  /etc/ssh/sshd_config.d/99-mac-bootstrap.conf",
            "",
            "The drop-in disables password/root login, tightens auth attempts, validates",
            "with `sshd -t`, and reloads sshd. If validation fails, the drop-in is removed."
          ].join("\n")
      },
      "cask-quarantine": {
        summary: "Targeted cleanup for quarantined helper binaries inside Homebrew Casks.",
        body: () =>
          [
            "Detects nested helper binaries named `rg` under Homebrew's Caskroom,",
            "including Codex's bundled helper at:",
            "  $(brew --prefix)/Caskroom/codex/<version>/codex-path/rg",
            "",
            "Apply removes only this xattr from matching Homebrew Cask helpers:",
            "  /usr/bin/xattr -d com.apple.quarantine <helper>",
            "",
            "This is intentionally narrow: it does not disable Gatekeeper and does",
            "not recursively strip quarantine from Downloads or /Applications. Nightly",
            "runs the same sweep after `brew upgrade --cask` because a cask update can",
            "replace the helper binary and reintroduce the xattr."
          ].join("\n")
      },
      apply: {
        summary: "What --apply changes and what stays manual.",
        body: () =>
          [
            "  --dry-run              print planned apply commands without changing state",
            "  --apply                run automated hardening where safe",
            "  --skip filevault       skip one module; repeatable",
            "  --ssh-mode disable     turn Remote Login off instead of writing a drop-in",
            "  --ssh-mode harden      keep SSH on but apply the hardening drop-in",
            "",
            "FileVault enablement is always printed as a manual command. Cask",
            "quarantine cleanup is automated but only targets nested helpers under",
            "Homebrew's Caskroom."
          ].join("\n")
      },
      examples: {
        summary: "Common security invocations.",
        body: () =>
          [
            "  mac-bootstrap security",
            "  mac-bootstrap security --dry-run --apply",
            "  mac-bootstrap security --apply --ssh-mode disable",
            "  mac-bootstrap security --apply --skip filevault",
            "  mac-bootstrap security --apply --skip filevault --skip firewall --skip ssh-hardening",
            "  mac-bootstrap security --help ssh-hardening"
          ].join("\n")
      }
    }
  }
};

// --- printer -----------------------------------------------------------------

function listTopics(node, command, trail, logger, useColor) {
  const topics = node.topics || {};
  const names = Object.keys(topics);
  if (names.length === 0) {
    return;
  }
  logger.log("");
  logger.log(heading("More help:", useColor));
  const width = Math.max(...names.map((name) => name.length));
  for (const name of names) {
    logger.log(`  ${colorize(name.padEnd(width), "cyan", useColor)}   ${topics[name].summary}`);
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
  const useColor = resolveUseColor(undefined, process.stdout);

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

  logger.log(heading(trail.join(" › "), useColor));
  logger.log(node.summary);
  if (node.usage) {
    logger.log("");
    logger.log(`${heading("Usage:", useColor)} ${node.usage}`);
  }
  if (typeof node.body === "function") {
    logger.log("");
    logger.log(node.body(ctx));
  }
  listTopics(node, command, trail, logger, useColor);
  return 0;
}
