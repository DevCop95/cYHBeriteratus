const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeTool } = require("../tools");

test("run_command executes echo and returns stdout", async () => {
  const r = await executeTool("run_command", { command: "echo cyhberiteratus_test" });
  assert.equal(r.success, true);
  assert.ok(
    r.result.includes("cyhberiteratus_test"),
    `Expected 'cyhberiteratus_test' in output, got: ${r.result}`
  );
}, { timeout: 15000 });

test("run_command returns error for empty command string", async () => {
  const r = await executeTool("run_command", { command: "" });
  assert.equal(r.success, false);
});

test("run_command returns error when command key is absent", async () => {
  const r = await executeTool("run_command", {});
  assert.equal(r.success, false);
});

test("run_command captures stderr on failing command", async () => {
  const r = await executeTool("run_command", { command: "Get-Item C:\\nonexistent_path_xyz" });
  assert.equal(r.success, false);
}, { timeout: 15000 });
