const path = require("path");

const config = {
  HOST: "127.0.0.1",
  APP_PORT: Number(process.env.APP_PORT || 4000),
  OLLAMA_HOST: process.env.OLLAMA_HOST || "127.0.0.1",
  OLLAMA_PORT: Number(process.env.OLLAMA_PORT || 11434),
  OLLAMA_TIMEOUT_MS: Number(process.env.OLLAMA_TIMEOUT_MS || 120000),
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || "huihui_ai/qwen2.5-abliterate:7b-instruct",
  MAX_TOOL_ROUNDS: 8,
  PUBLIC_DIR: path.join(__dirname, "..", "public"),
  WORKSPACE_DIR: path.normalize(path.join(__dirname, "..")),
};

module.exports = config;
