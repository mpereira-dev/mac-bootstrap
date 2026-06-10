import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { askYesNo, pickProfiles } from "../src/prompt.js";
import { TestLogger } from "./helpers.js";

async function answerYesNo(answer, defaultYes = true) {
  const input = new PassThrough();
  const output = new PassThrough();
  const result = askYesNo("Proceed?", defaultYes, input, output);
  input.end(answer);
  return result;
}

test("askYesNo returns true for blank default-yes input", async () => {
  assert.equal(await answerYesNo("\n", true), true);
});

test("askYesNo returns false for n", async () => {
  assert.equal(await answerYesNo("n\n", true), false);
});

test("askYesNo returns true for y", async () => {
  assert.equal(await answerYesNo("y\n", false), true);
});

test("askYesNo returns true for yes", async () => {
  assert.equal(await answerYesNo("yes\n", false), true);
});

test("askYesNo returns false for garbage", async () => {
  assert.equal(await answerYesNo("garbage\n", true), false);
});

test("pickProfiles iterates profiles with injected prompt", async () => {
  const manifest = {
    profiles: {
      core: { description: "Core tools", defaultEnabled: true },
      node: { description: "Node tools", defaultEnabled: true },
      ai: { description: "AI tools", defaultEnabled: false }
    },
    formulae: [
      { name: "gh", profile: "core" },
      { name: "volta", profile: "node" }
    ],
    casks: [
      { name: "claude-code", profile: "ai" }
    ]
  };
  const calls = [];
  const logger = new TestLogger();
  const selected = await pickProfiles({
    manifest,
    logger,
    defaults: ["core", "node"],
    prompt: async (question, defaultYes) => {
      calls.push([question, defaultYes]);
      return question.includes("core") || question.includes("ai");
    }
  });

  assert.deepEqual(selected, ["core", "ai"]);
  assert.deepEqual(calls, [
    ["Enable core?", true],
    ["Enable node?", true],
    ["Enable ai?", false]
  ]);
  assert.match(logger.text(), /gh/);
  assert.match(logger.text(), /claude-code/);
});
