const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool, parsePorts, extractHost } = require("../tools");

test("hash_text produces known digests", async () => {
  const res = await executeTool("hash_text", { text: "abc" });
  assert.strictEqual(res.success, true);
  // Known vectors for "abc"
  assert.match(res.result, /sha256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/);
  assert.match(res.result, /md5: 900150983cd24fb0d6963f7d28e17f72/);
});

test("hash_text honours a single algorithm", async () => {
  const res = await executeTool("hash_text", { text: "abc", algorithm: "sha1" });
  assert.strictEqual(res.result, "sha1: a9993e364706816aba3e25717850c26c9cd0d89d");
});

test("hash_text rejects missing text", async () => {
  const res = await executeTool("hash_text", {});
  assert.strictEqual(res.success, false);
});

test("parsePorts handles presets, ranges and lists", () => {
  assert.ok(parsePorts("common").length > 10);
  assert.strictEqual(parsePorts("1-100").length, 100);
  assert.deepStrictEqual(parsePorts("22,80,443"), [22, 80, 443]);
  assert.deepStrictEqual(parsePorts([22, 99999, -1, 443]), [22, 443]);
});

test("extractHost strips scheme, port and path", () => {
  assert.strictEqual(extractHost("https://ex.com:8443/path"), "ex.com");
  assert.strictEqual(extractHost("HTTP://Example.com/"), "Example.com");
});

test("port_scan refuses CIDR ranges", async () => {
  const res = await executeTool("port_scan", { host: "10.0.0.0/24" });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /single host/i);
});

test("port_scan caps the number of ports", async () => {
  const res = await executeTool("port_scan", { host: "127.0.0.1", ports: "1-2000" });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /Maximum/);
});

test("http_headers rejects non-http protocols", async () => {
  const res = await executeTool("http_headers", { url: "ftp://example.com" });
  assert.strictEqual(res.success, false);
});

test("web_search requires a query", async () => {
  const res = await executeTool("web_search", {});
  assert.strictEqual(res.success, false);
});

test("web_search definition exposes max_results", () => {
  const { toolDefinitions } = require("../tools");
  const def = toolDefinitions.find((d) => d.function.name === "web_search");
  assert.ok(def.function.parameters.properties.max_results);
});
