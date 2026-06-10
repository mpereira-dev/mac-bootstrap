import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { askYesNo, pickProfiles, pickProfilesInteractive } from "../src/prompt.js";
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

// Fake stdin that lets us emit synthetic keypress events without engaging the
// real raw-mode terminal. The interactive picker only calls resume/pause/off
// and listens on the "keypress" event, so this minimal stub is enough.
function fakeTtyInput() {
  const emitter = new EventEmitter();
  emitter.isRaw = false;
  emitter.isTTY = false;
  emitter.setRawMode = () => {};
  emitter.resume = () => {};
  emitter.pause = () => {};
  return emitter;
}

function silentOutput() {
  return { write: () => {} };
}

test("pickProfilesInteractive returns defaults on enter", async () => {
  const manifest = {
    profiles: { core: {}, ai: {}, mobile: {} },
    formulae: [],
    casks: []
  };
  const input = fakeTtyInput();
  const promise = pickProfilesInteractive({
    manifest,
    defaults: ["core", "ai"],
    input,
    output: silentOutput()
  });
  setImmediate(() => input.emit("keypress", "", { name: "return" }));
  assert.deepEqual(await promise, ["core", "ai"]);
});

test("pickProfilesInteractive toggles selection with space", async () => {
  const manifest = {
    profiles: { core: {}, ai: {}, mobile: {} },
    formulae: [],
    casks: []
  };
  const input = fakeTtyInput();
  const promise = pickProfilesInteractive({
    manifest,
    defaults: ["core"],
    input,
    output: silentOutput()
  });
  // Cursor starts on core (index 0). Down to ai (1), space to enable, then enter.
  process.nextTick(() => {
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "space" });
    input.emit("keypress", "", { name: "return" });
  });
  assert.deepEqual(await promise, ["core", "ai"]);
});

test("pickProfilesInteractive toggles all with a", async () => {
  const manifest = {
    profiles: { core: {}, ai: {}, mobile: {} },
    formulae: [],
    casks: []
  };
  const input = fakeTtyInput();
  const promise = pickProfilesInteractive({
    manifest,
    defaults: [],
    input,
    output: silentOutput()
  });
  process.nextTick(() => {
    input.emit("keypress", "", { name: "a" });
    input.emit("keypress", "", { name: "return" });
  });
  assert.deepEqual(await promise, ["core", "ai", "mobile"]);
});

test("pickProfilesInteractive rejects on q", async () => {
  const manifest = {
    profiles: { core: {} },
    formulae: [],
    casks: []
  };
  const input = fakeTtyInput();
  const promise = pickProfilesInteractive({
    manifest,
    defaults: ["core"],
    input,
    output: silentOutput()
  });
  process.nextTick(() => input.emit("keypress", "", { name: "q" }));
  await assert.rejects(promise, /cancelled/i);
});
