const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const CURRENT_LEVEL = LEVELS.INFO;

function log(levelName, message, meta = {}) {
  const levelValue = LEVELS[levelName];
  if (levelValue < CURRENT_LEVEL) return;

  const timestamp = new Date().toISOString();
  const metaString = Object.keys(meta).length ? JSON.stringify(meta) : "";
  
  const prefix = `[${timestamp}] [${levelName}]`;
  
  if (levelName === "ERROR") {
    console.error(`${prefix} ${message} ${metaString}`);
  } else if (levelName === "WARN") {
    console.warn(`${prefix} ${message} ${metaString}`);
  } else {
    console.log(`${prefix} ${message} ${metaString}`);
  }
}

module.exports = {
  debug: (msg, meta) => log("DEBUG", msg, meta),
  info: (msg, meta) => log("INFO", msg, meta),
  warn: (msg, meta) => log("WARN", msg, meta),
  error: (msg, meta) => log("ERROR", msg, meta),
};
