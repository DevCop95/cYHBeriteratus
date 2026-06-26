const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isPrivateIP } = require("../tools");

// ── IPv4 private ranges ──
test("blocks 127.0.0.1 (loopback)", () => assert.equal(isPrivateIP("127.0.0.1"), true));
test("blocks 127.255.255.255 (loopback end)", () => assert.equal(isPrivateIP("127.255.255.255"), true));
test("blocks 10.0.0.1 (RFC1918 /8)", () => assert.equal(isPrivateIP("10.0.0.1"), true));
test("blocks 10.255.255.255 (RFC1918 /8 end)", () => assert.equal(isPrivateIP("10.255.255.255"), true));
test("blocks 192.168.0.1 (RFC1918 /16)", () => assert.equal(isPrivateIP("192.168.0.1"), true));
test("blocks 172.16.0.1 (RFC1918 /12 start)", () => assert.equal(isPrivateIP("172.16.0.1"), true));
test("blocks 172.31.255.255 (RFC1918 /12 end)", () => assert.equal(isPrivateIP("172.31.255.255"), true));
test("blocks 169.254.1.1 (link-local)", () => assert.equal(isPrivateIP("169.254.1.1"), true));
test("blocks 0.0.0.0", () => assert.equal(isPrivateIP("0.0.0.0"), true));

// ── IPv4 public ──
test("allows 8.8.8.8 (Google DNS)", () => assert.equal(isPrivateIP("8.8.8.8"), false));
test("allows 1.1.1.1 (Cloudflare)", () => assert.equal(isPrivateIP("1.1.1.1"), false));
test("allows 172.15.255.255 (just outside RFC1918)", () => assert.equal(isPrivateIP("172.15.255.255"), false));
test("allows 172.32.0.0 (just outside RFC1918)", () => assert.equal(isPrivateIP("172.32.0.0"), false));

// ── IPv6 ──
test("blocks ::1 (loopback)", () => assert.equal(isPrivateIP("::1"), true));
test("blocks :: (unspecified)", () => assert.equal(isPrivateIP("::"), true));
test("blocks fe80::1 (link-local)", () => assert.equal(isPrivateIP("fe80::1"), true));
test("blocks fd00::1 (ULA fd)", () => assert.equal(isPrivateIP("fd00::1"), true));
test("blocks fc00::1 (ULA fc)", () => assert.equal(isPrivateIP("fc00::1"), true));
test("blocks ::ffff:127.0.0.1 (IPv4-mapped loopback)", () => assert.equal(isPrivateIP("::ffff:127.0.0.1"), true));
test("blocks ::ffff:192.168.1.1 (IPv4-mapped private)", () => assert.equal(isPrivateIP("::ffff:192.168.1.1"), true));
