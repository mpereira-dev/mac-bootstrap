import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { defaultProfiles, loadSelections, saveSelections, selectionsPath } from "../src/selections.js";
import { tempHome } from "./helpers.js";

test("selections save and load round-trip", () => {
  const home = tempHome();
  const file = saveSelections(home, ["core", "ai"], "2026-06-10T00:00:00.000Z");
  assert.equal(file, selectionsPath(home));
  assert.deepEqual(loadSelections(home), {
    profiles: ["core", "ai"],
    savedAt: "2026-06-10T00:00:00.000Z"
  });
});

test("loadSelections returns null for missing file", () => {
  const home = tempHome();
  assert.equal(loadSelections(home), null);
});

test("loadSelections returns null for invalid JSON", () => {
  const home = tempHome();
  fs.mkdirSync(`${home}/.mac-bootstrap`, { recursive: true });
  fs.writeFileSync(selectionsPath(home), "{not json");
  assert.equal(loadSelections(home), null);
});

test("defaultProfiles returns default-enabled profile names", () => {
  const manifest = {
    profiles: {
      core: { defaultEnabled: true },
      mobile: { defaultEnabled: false },
      network: {},
      ai: { defaultEnabled: true }
    }
  };
  assert.deepEqual(defaultProfiles(manifest), ["core", "ai"]);
});
