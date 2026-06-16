import assert from "node:assert/strict";
import test from "node:test";
import { bootstrap } from "../src/bootstrap.js";
import { doctor } from "../src/doctor.js";
import { FakeRunner, tempHome, TestLogger } from "../test/helpers.js";

const ALL_PROFILES = ["core", "node", "python", "ai", "mobile", "network", "cloud"];

test("bootstrap into isolated HOME then doctor passes", async () => {
  const home = tempHome();
  const runner = new FakeRunner({ xcodeInstalled: false });
  const bootstrapLog = new TestLogger();
  const bootstrapExit = await bootstrap({ home, runner, logger: bootstrapLog, profiles: ALL_PROFILES, networkCheck: async () => true });
  assert.equal(bootstrapExit, 0);

  const doctorLog = new TestLogger();
  const doctorExit = await doctor({ home, runner, logger: doctorLog });
  assert.equal(doctorExit, 0, doctorLog.text());
});
