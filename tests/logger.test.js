const { test, mock } = require("node:test");
const assert = require("node:assert/strict");

function freshLogger(level) {
  delete require.cache[require.resolve("../src/utils/logger")];
  if (level === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = level;
  }
  return require("../src/utils/logger");
}

test("debug is suppressed at default INFO level", () => {
  const logger = freshLogger(undefined);
  const spy = mock.method(console, "log", () => {});
  try {
    logger.debug("should be hidden");
    assert.equal(spy.mock.calls.length, 0);
  } finally {
    spy.mock.restore();
  }
});

test("info is emitted at default INFO level", () => {
  const logger = freshLogger(undefined);
  const spy = mock.method(console, "log", () => {});
  try {
    logger.info("should appear");
    assert.equal(spy.mock.calls.length, 1);
    assert.ok(spy.mock.calls[0].arguments.join(" ").includes("should appear"));
  } finally {
    spy.mock.restore();
  }
});

test("debug is emitted when LOG_LEVEL=DEBUG", () => {
  const logger = freshLogger("DEBUG");
  const spy = mock.method(console, "log", () => {});
  try {
    logger.debug("debug message");
    assert.equal(spy.mock.calls.length, 1);
  } finally {
    spy.mock.restore();
  }
});

test("debug and info are suppressed at LOG_LEVEL=WARN", () => {
  const logger = freshLogger("WARN");
  const spy = mock.method(console, "log", () => {});
  try {
    logger.debug("hidden");
    logger.info("also hidden");
    assert.equal(spy.mock.calls.length, 0);
  } finally {
    spy.mock.restore();
  }
});

test("invalid LOG_LEVEL falls back to INFO", () => {
  const logger = freshLogger("NONSENSE");
  const spy = mock.method(console, "log", () => {});
  try {
    logger.debug("should be hidden");
    logger.info("should appear");
    assert.equal(spy.mock.calls.length, 1);
  } finally {
    spy.mock.restore();
    delete process.env.LOG_LEVEL;
    delete require.cache[require.resolve("../src/utils/logger")];
  }
});
