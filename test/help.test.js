import assert from "node:assert/strict";
import test from "node:test";
import { printHelp, renderProfileTable, renderTable } from "../src/help.js";
import { loadManifest } from "../src/manifest.js";
import { resolvePreset } from "../src/selections.js";
import { TestLogger } from "./helpers.js";

test("renderTable aligns columns with a box border", () => {
  const out = renderTable(["A", "BB"], [["1", "22"], ["333", "4"]]);
  const lines = out.split("\n");
  assert.equal(lines[0].startsWith("┌"), true);
  assert.equal(lines.at(-1).startsWith("└"), true);
  // every rendered line is the same visual width
  const widths = new Set(lines.map((line) => [...line].length));
  assert.equal(widths.size, 1);
});

test("renderProfileTable lists every profile with its default state", () => {
  const table = renderProfileTable(loadManifest());
  assert.match(table, /Profile/);
  assert.match(table, /core .* on/);
  assert.match(table, /python .* on/);
  assert.match(table, /ai .* off/);
  assert.match(table, /aws-cdk/);
});

test("printHelp prints a command overview and its topics", () => {
  const logger = new TestLogger();
  const code = printHelp("bootstrap", [], { logger });
  assert.equal(code, 0);
  assert.match(logger.text(), /Install the owner-approved baseline/);
  assert.match(logger.text(), /More help:/);
  assert.match(logger.text(), /profiles/);
});

test("printHelp walks into a nested topic and renders the table", () => {
  const logger = new TestLogger();
  const code = printHelp("bootstrap", ["profiles"], { logger });
  assert.equal(code, 0);
  assert.match(logger.text(), /bootstrap › profiles/);
  assert.match(logger.text(), /┌/); // the table
  assert.match(logger.text(), /selection/); // subtopic listed
});

test("printHelp reaches a deeply nested topic", () => {
  const logger = new TestLogger();
  const code = printHelp("bootstrap", ["profiles", "selection"], { logger });
  assert.equal(code, 0);
  assert.match(logger.text(), /bootstrap › profiles › selection/);
  assert.match(logger.text(), /--preset/);
});

test("printHelp reports an unknown topic with the available ones", () => {
  const logger = new TestLogger();
  const code = printHelp("bootstrap", ["nope"], { logger });
  assert.equal(code, 1);
  assert.match(logger.text(), /Unknown help topic: nope/);
  assert.match(logger.text(), /profiles/);
});

test("migrate help explains detection and removal", () => {
  const detection = new TestLogger();
  printHelp("migrate", ["detection"], { logger: detection });
  assert.match(detection.text(), /symlink chain/);
  assert.match(detection.text(), /pkgutil|receipt/);

  const removal = new TestLogger();
  printHelp("migrate", ["removal"], { logger: removal });
  assert.match(removal.text(), /install the managed version first/);
});

test("printHelp renders the preset table", () => {
  const logger = new TestLogger();
  const code = printHelp("bootstrap", ["presets"], { logger });
  assert.equal(code, 0);
  assert.match(logger.text(), /Preset/);
  assert.match(logger.text(), /ranger .* core, node, python, cloud/);
});

test("resolvePreset maps codenames to profiles and rejects unknowns", () => {
  const manifest = loadManifest();
  assert.deepEqual(resolvePreset(manifest, "scout"), ["core", "node", "python"]);
  assert.deepEqual(resolvePreset(manifest, "maverick"), [
    "core",
    "node",
    "python",
    "ai",
    "mobile",
    "network",
    "cloud"
  ]);
  assert.equal(resolvePreset(manifest, "nope"), null);
});
