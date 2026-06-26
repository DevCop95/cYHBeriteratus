const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeTool } = require("../tools");
const fs = require("fs").promises;
const path = require("path");

const TEMP = "tests/_tmp_write_test.txt";
const TEMP_ABS = path.join(__dirname, "..", TEMP);

test("write_file creates a file within the workspace", async () => {
  const r = await executeTool("write_file", { file_path: TEMP, content: "hello world" });
  assert.equal(r.success, true);
  const written = await fs.readFile(TEMP_ABS, "utf8");
  assert.equal(written, "hello world");
});

test("read_file reads back what was written", async () => {
  const r = await executeTool("read_file", { file_path: TEMP });
  assert.equal(r.success, true);
  assert.ok(r.result.includes("hello world"));
});

test("read_file blocks path traversal (../../)", async () => {
  const r = await executeTool("read_file", { file_path: "../../Windows/System32/drivers/etc/hosts" });
  assert.equal(r.success, false);
});

test("write_file blocks path traversal (../../)", async () => {
  const r = await executeTool("write_file", { file_path: "../../tmp/evil.txt", content: "x" });
  assert.equal(r.success, false);
});

test("list_directory lists the tests folder", async () => {
  const r = await executeTool("list_directory", { dir_path: "tests" });
  assert.equal(r.success, true);
  assert.ok(r.result.includes("validator.test.js"));
});

test("read_file returns error for missing file_path arg", async () => {
  const r = await executeTool("read_file", {});
  assert.equal(r.success, false);
});

test("write_file returns error for missing content arg", async () => {
  const r = await executeTool("write_file", { file_path: TEMP });
  assert.equal(r.success, false);
});

test("cleanup temp file", async () => {
  try { await fs.unlink(TEMP_ABS); } catch {}
  assert.ok(true);
});
