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

test("extractHost handles IPv6 formats", () => {
  assert.strictEqual(extractHost("[::1]:8080"), "::1");
  assert.strictEqual(extractHost("[::1]"), "::1");
  assert.strictEqual(extractHost("::1"), "::1");
  assert.strictEqual(extractHost("2001:db8::1"), "2001:db8::1");
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

test("http_headers blocks loopback and private IP (SSRF)", async () => {
  const loopback = await executeTool("http_headers", { url: "http://127.0.0.1:8080/" });
  assert.strictEqual(loopback.success, false);
  assert.match(loopback.error, /SSRF|internal/i);

  const privateIp = await executeTool("http_headers", { url: "http://10.0.0.1/" });
  assert.strictEqual(privateIp.success, false);
  assert.match(privateIp.error, /SSRF|internal/i);
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

test("stripHtml removes nav, scripts, styles, svgs, and collapses excessive blank lines", () => {
  const { stripHtml } = require("../tools");
  const sample = `
    <html>
      <head><style>body { color: red; }</style></head>
      <body>
        <nav><a href="/home">Home</a> <svg><circle /></svg></nav>
        <header><h1>Site Header</h1></header>
        <!-- A comment -->
        <div class="content">
          <p>First paragraph with &amp; entity &quot;quotes&quot; and &#39;apostrophe&#39;.</p>
          
          
          <p>Second paragraph after multiple blank lines.</p>
        </div>
        <footer>Copyright 2026</footer>
        <script>alert(1);</script>
      </body>
    </html>
  `;
  const cleaned = stripHtml(sample);
  assert.ok(!cleaned.includes("Site Header"), "Header should be removed");
  assert.ok(!cleaned.includes("Home"), "Nav should be removed");
  assert.ok(!cleaned.includes("alert(1)"), "Script should be removed");
  assert.ok(!cleaned.includes("color: red"), "Style should be removed");
  assert.ok(!cleaned.includes("Copyright"), "Footer should be removed");
  assert.ok(cleaned.includes("First paragraph with & entity \"quotes\" and 'apostrophe'."));
  assert.ok(cleaned.includes("Second paragraph"));
  assert.ok(!/\n{3,}/.test(cleaned), "Should have no triple newlines");
  assert.ok(!/^[ \t]+$/m.test(cleaned), "Should have no blank lines containing only spaces");
});

