const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeTool } = require("../tools");

test("blocks web_fetch to 127.0.0.1 (SSRF loopback)", async () => {
  const r = await executeTool("web_fetch", { url: "http://127.0.0.1/" });
  assert.equal(r.success, false);
  assert.ok(
    r.error.includes("SSRF") || r.error.includes("interna"),
    `Expected SSRF error, got: ${r.error}`
  );
});

test("blocks web_fetch to file:// protocol", async () => {
  const r = await executeTool("web_fetch", { url: "file:///etc/passwd" });
  assert.equal(r.success, false);
});

test("blocks web_fetch to ftp:// protocol", async () => {
  const r = await executeTool("web_fetch", { url: "ftp://example.com/file" });
  assert.equal(r.success, false);
});

test("blocks web_fetch to 10.0.0.1 (RFC1918)", async () => {
  const r = await executeTool("web_fetch", { url: "http://10.0.0.1/" });
  assert.equal(r.success, false);
  assert.ok(
    r.error.includes("SSRF") || r.error.includes("interna"),
    `Expected SSRF error, got: ${r.error}`
  );
});

test("returns error for unknown tool name", async () => {
  const r = await executeTool("nonexistent_tool", {});
  assert.equal(r.success, false);
  assert.ok(r.error.includes("Unknown"), `Expected 'Unknown' in error, got: ${r.error}`);
});

test("blocks web_fetch with missing url", async () => {
  const r = await executeTool("web_fetch", {});
  assert.equal(r.success, false);
});
