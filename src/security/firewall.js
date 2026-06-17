// macOS Application Firewall module — detect / suggest / apply.
// What this protects: inbound connections initiated from other hosts (e.g.
// coffee-shop Wi-Fi probes, nmap scans). Outbound traffic is NOT affected —
// Claude Code remote, GitHub, Discord, Nightshift all egress freely.
//
// What we enable:
//   --setglobalstate on        — turns on the firewall
//   --setstealthmode on        — don't reply to ICMP/probes (you become invisible to scans)
//   --setallowsigned on        — Apple-signed apps allowed inbound (defaults; harmless)
//   --setallowsignedapp on     — signed third-party apps allowed inbound (defaults)
//
// What we DON'T enable:
//   --setblockall on           — too aggressive; kills mDNS/Bonjour/AirDrop and local
//                                LAN reach to dev servers from other devices.

export const name = "firewall";

const FW = "/usr/libexec/ApplicationFirewall/socketfilterfw";

async function getState(runner, flag) {
  const result = await runner.run(FW, [flag]);
  return result.exitCode === 0 ? (result.stdout || "").trim() : null;
}

export async function detect({ runner } = {}) {
  if (!runner) throw new Error("firewall.detect: runner is required");
  const [globalState, stealthState] = await Promise.all([
    getState(runner, "--getglobalstate"),
    getState(runner, "--getstealthmode"),
  ]);
  if (globalState == null || stealthState == null) {
    return { ok: false, enabled: null, stealth: null, error: "socketfilterfw query failed", detail: { globalState, stealthState } };
  }
  return {
    ok: true,
    enabled: /enabled/i.test(globalState),
    stealth: /enabled/i.test(stealthState),
    detail: { globalState, stealthState },
  };
}

export async function suggest({ current } = {}) {
  if (!current?.ok) return { advice: "cannot determine firewall state — investigate `socketfilterfw --getglobalstate`" };
  const todo = [];
  if (!current.enabled) todo.push("enable firewall (sudo socketfilterfw --setglobalstate on)");
  if (!current.stealth) todo.push("enable stealth mode (sudo socketfilterfw --setstealthmode on)");
  if (todo.length === 0) return { advice: "firewall + stealth enabled — no action" };
  return {
    advice: `firewall is ${current.enabled ? "ON" : "OFF"}, stealth is ${current.stealth ? "ON" : "OFF"} — apply hardening`,
    commands: todo,
    notes: [
      "Outbound traffic (Claude Code, GitHub, Discord) is unaffected",
      "Loopback (127.0.0.1) is always allowed — dev servers work",
      "Don't enable --setblockall — it kills mDNS/Bonjour/AirDrop and breaks too much",
    ],
  };
}

export async function apply({ runner, logger = console, dryRun = false } = {}) {
  if (!runner) throw new Error("firewall.apply: runner is required");
  const before = await detect({ runner });
  if (!before.ok) {
    logger.log(`firewall: cannot determine state — ${before.error || "detect failed"}`);
    return { changed: false, error: before.error || "detect failed" };
  }
  if (before.ok && before.enabled && before.stealth) {
    logger.log("firewall: already enabled with stealth — noop");
    return { changed: false };
  }
  const cmds = [];
  if (!before.enabled) cmds.push([FW, ["--setglobalstate", "on"]]);
  if (!before.stealth) cmds.push([FW, ["--setstealthmode", "on"]]);
  if (dryRun) {
    for (const [cmd, args] of cmds) logger.log(`firewall: DRY RUN — would run sudo ${cmd} ${args.join(" ")}`);
    return { changed: false, dryRun: true };
  }
  // socketfilterfw requires root. Run via sudo. (User will be prompted unless cached.)
  for (const [cmd, args] of cmds) {
    logger.log(`firewall: sudo ${cmd} ${args.join(" ")}`);
    const result = await runner.run("sudo", [cmd, ...args]);
    if (result.exitCode !== 0) {
      logger.log(`firewall: command failed (exit ${result.exitCode}): ${result.stderr}`);
      return { changed: false, error: `apply failed at ${cmd} ${args.join(" ")}` };
    }
  }
  const after = await detect({ runner });
  return { changed: true, before, after };
}
