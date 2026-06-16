import assert from "node:assert/strict";
import test from "node:test";
import { printHelp, renderProfileTable, renderTable } from "../src/help.js";
import { loadManifest } from "../src/manifest.js";
import { profileNamesToShow } from "../src/selections.js";
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

test("renderProfileTable lists every profile with default + picker state", () => {
  const table = renderProfileTable(loadManifest());
  assert.match(table, /Profile/);
  assert.match(table, /core .* on .* shown/);
  assert.match(table, /ai .* off .* hidden/);
  assert.match(table, /cloud .* off .* shown/);
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
  assert.match(logger.text(), /hidden/); // subtopic listed
});

test("printHelp reaches a deeply nested topic", () => {
  const logger = new TestLogger();
  const code = printHelp("bootstrap", ["profiles", "hidden"], { logger });
  assert.equal(code, 0);
  assert.match(logger.text(), /bootstrap › profiles › hidden/);
  assert.match(logger.text(), /--all-profiles/);
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

test("profileNamesToShow hides ai/mobile/network unless all or included", () => {
  const manifest = loadManifest();
  assert.deepEqual(profileNamesToShow(manifest), ["core", "node", "cloud"]);
  assert.deepEqual(profileNamesToShow(manifest, { all: true }), [
    "core",
    "node",
    "ai",
    "mobile",
    "network",
    "cloud"
  ]);
  // an already-enabled hidden profile stays visible so reconfigure never drops it
  assert.deepEqual(profileNamesToShow(manifest, { include: ["mobile"] }), [
    "core",
    "node",
    "mobile",
    "cloud"
  ]);
});
