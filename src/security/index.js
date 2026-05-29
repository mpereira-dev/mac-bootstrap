// Security modules — uniform interface.
// Each module exports: name, detect({runner}), suggest({current}), apply({runner, dryRun, logger, ...}).

import * as filevault from "./filevault.js";
import * as firewall from "./firewall.js";
import * as sshHardening from "./ssh-hardening.js";

export const MODULES = [filevault, firewall, sshHardening];

export async function detectAll({ runner } = {}) {
  const out = {};
  for (const m of MODULES) {
    try {
      out[m.name] = await m.detect({ runner });
    } catch (e) {
      out[m.name] = { ok: false, error: e.message };
    }
  }
  return out;
}

export async function suggestAll({ runner } = {}) {
  const states = await detectAll({ runner });
  const out = {};
  for (const m of MODULES) {
    out[m.name] = await m.suggest({ current: states[m.name] });
  }
  return out;
}

export { filevault, firewall, sshHardening };
