const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateChatRequest } = require("../src/middlewares/validator");

test("passes with valid user message", () => {
  const r = validateChatRequest({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(r.valid, true);
});

test("passes with empty messages array", () => {
  const r = validateChatRequest({ messages: [] });
  assert.equal(r.valid, true);
});

test("passes with no messages field", () => {
  const r = validateChatRequest({});
  assert.equal(r.valid, true);
});

test("passes with multiple valid messages", () => {
  const r = validateChatRequest({
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
  });
  assert.equal(r.valid, true);
});

test("fails when messages is a string instead of array", () => {
  const r = validateChatRequest({ messages: "not an array" });
  assert.equal(r.valid, false);
});

test("fails when role is missing", () => {
  const r = validateChatRequest({ messages: [{ content: "hello" }] });
  assert.equal(r.valid, false);
});

test("fails when role is a number", () => {
  const r = validateChatRequest({ messages: [{ role: 1, content: "hello" }] });
  assert.equal(r.valid, false);
});

test("fails when content is null", () => {
  const r = validateChatRequest({ messages: [{ role: "user", content: null }] });
  assert.equal(r.valid, false);
});

test("fails when content is a number", () => {
  const r = validateChatRequest({ messages: [{ role: "user", content: 42 }] });
  assert.equal(r.valid, false);
});

test("fails when content is an object", () => {
  const r = validateChatRequest({ messages: [{ role: "user", content: {} }] });
  assert.equal(r.valid, false);
});

test("fails when content is missing entirely", () => {
  const r = validateChatRequest({ messages: [{ role: "user" }] });
  assert.equal(r.valid, false);
});
