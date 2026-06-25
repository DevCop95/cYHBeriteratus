const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const config = require("./src/config");
const logger = require("./src/utils/logger");
const { rateLimiter, applySecurityHeaders } = require("./src/middlewares/security");
const { parseJsonBody, validateChatRequest } = require("./src/middlewares/validator");
const { toolDefinitions, executeTool } = require("./tools");

// ── Keep-alive agent for Ollama connections (reuse TCP sockets) ──
const ollamaAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 6,
  maxFreeSockets: 4,
});

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

// ── In-memory static file cache ──
const fileCache = new Map();
const CACHE_MAX_SIZE = 50;
const CACHE_MAX_FILE_BYTES = 512 * 1024;

function getCachedFile(absolutePath) {
  const cached = fileCache.get(absolutePath);
  if (cached) {
    fileCache.delete(absolutePath);
    fileCache.set(absolutePath, cached);
    return cached;
  }
  return null;
}

function setCachedFile(absolutePath, data, stat) {
  if (data.length > CACHE_MAX_FILE_BYTES) return;
  if (fileCache.size >= CACHE_MAX_SIZE) {
    fileCache.delete(fileCache.keys().next().value);
  }
  fileCache.set(absolutePath, {
    data,
    etag: `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`,
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function serveFile(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const safePath = path.normalize(path.join(config.PUBLIC_DIR, pathname));

  if (!safePath.startsWith(config.PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Ruta no permitida." });
    return;
  }

  const ext = path.extname(safePath).toLowerCase();
  const mimeType = contentTypes[ext] || "application/octet-stream";
  applySecurityHeaders(res);

  const cached = getCachedFile(safePath);
  if (cached) {
    if (req.headers["if-none-match"] === cached.etag) {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": mimeType, ETag: cached.etag });
    return res.end(cached.data);
  }

  fs.stat(safePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("404 Not Found");
    }

    fs.readFile(safePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end("500 Internal Server Error");
      }
      setCachedFile(safePath, data, stat);
      const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
      res.writeHead(200, { "Content-Type": mimeType, ETag: etag });
      res.end(data);
    });
  });
}

// ── Ollama HTTP Wrappers ──
function ollamaRequest(apiPath, payload = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: config.OLLAMA_HOST,
      port: config.OLLAMA_PORT,
      path: apiPath,
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : {},
      agent: ollamaAgent,
      timeout: config.OLLAMA_TIMEOUT_MS,
    };

    const ollamaReq = http.request(options, (ollamaRes) => {
      let data = "";
      ollamaRes.on("data", (chunk) => { data += chunk; });
      ollamaRes.on("end", () => {
        if (ollamaRes.statusCode >= 400) {
          return reject(new Error(`Ollama HTTP ${ollamaRes.statusCode}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Respuesta de Ollama invalida (no es JSON)."));
        }
      });
    });

    ollamaReq.on("error", reject);
    ollamaReq.on("timeout", () => {
      ollamaReq.destroy(new Error("Timeout conectando a Ollama."));
    });

    if (payload) ollamaReq.write(JSON.stringify(payload));
    ollamaReq.end();
  });
}

async function streamOllamaChat(res, messages, model) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  const requestBody = JSON.stringify({
    model,
    stream: true,
    messages,
  });

  const options = {
    hostname: config.OLLAMA_HOST,
    port: config.OLLAMA_PORT,
    path: "/api/chat",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(requestBody),
    },
    agent: ollamaAgent,
  };

  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      if (err && !res.writableEnded) {
        logger.error("Error en stream", { error: err.message });
        res.write(`${JSON.stringify({ type: "error", error: err.message })}\n`);
      }
      if (!res.writableEnded) res.end();
      err ? reject(err) : resolve();
    };

    const ollamaReq = http.request(options, (ollamaRes) => {
      if (ollamaRes.statusCode !== 200) {
        let errData = "";
        ollamaRes.on("data", (chunk) => { errData += chunk; });
        ollamaRes.on("end", () => {
          finish(new Error(`Ollama respondio con error HTTP ${ollamaRes.statusCode}: ${errData}`));
        });
        return;
      }

      ollamaRes.on("data", (chunk) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              res.write(`${JSON.stringify({ type: "token", content: parsed.message.content })}\n`);
            }
            if (parsed.done) {
              res.write(`${JSON.stringify({ type: "done", done: true })}\n`);
            }
          } catch (e) {
            logger.warn("Ollama JSON parse error en stream", { line });
          }
        }
      });

      ollamaRes.on("end", () => finish());
      ollamaRes.on("error", finish);
    });

    ollamaReq.setTimeout(config.OLLAMA_TIMEOUT_MS, () => {
      ollamaReq.destroy(new Error("Timeout esperando stream de Ollama."));
    });

    const reqClose = () => ollamaReq.destroy(new Error("Cliente desconectado."));
    res.on("close", reqClose);
    ollamaReq.on("close", () => res.off("close", reqClose));
    ollamaReq.on("error", finish);
    ollamaReq.write(requestBody);
    ollamaReq.end();
  });
}

// ── HTTP Server Entrypoint ──
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && !reqUrl.pathname.startsWith("/api/")) {
    serveFile(req, res);
    return;
  }

  if (!rateLimiter(req, res)) return;

  if (req.method === "GET" && reqUrl.pathname === "/api/status") {
    try {
      const tags = await ollamaRequest("/api/tags");
      const models = Array.isArray(tags.models) ? tags.models : [];
      const modelLoaded = models.some((entry) => entry.name === config.OLLAMA_MODEL);

      sendJson(res, 200, {
        ok: true,
        host: config.OLLAMA_HOST,
        port: config.OLLAMA_PORT,
        model: config.OLLAMA_MODEL,
        modelLoaded,
        availableModels: models.map((entry) => entry.name),
      });
    } catch (error) {
      logger.error("Error obteniendo status de Ollama", { error: error.message });
      sendJson(res, 503, {
        ok: false,
        host: config.OLLAMA_HOST,
        port: config.OLLAMA_PORT,
        model: config.OLLAMA_MODEL,
        error: error.message,
      });
    }
    return;
  }

  if (req.method === "POST" && (reqUrl.pathname === "/api/chat" || reqUrl.pathname === "/api/chat-stream" || reqUrl.pathname === "/api/chat-agent")) {
    try {
      const parsed = await parseJsonBody(req, res);
      if (res.writableEnded) return;

      const validation = validateChatRequest(parsed);
      if (!validation.valid) {
        return sendJson(res, 400, { error: validation.error });
      }

      const history = parsed.messages || [];
      const model = parsed.model || config.OLLAMA_MODEL;

      if (reqUrl.pathname === "/api/chat") {
        const systemPrompt = "Eres una interfaz local de asistencia tecnica. Responde de forma clara, breve y util.";
        const response = await ollamaRequest("/api/chat", {
          model,
          stream: false,
          messages: [{ role: "system", content: systemPrompt }, ...history],
        });
        return sendJson(res, 200, {
          ok: true,
          model,
          message: response.message || { role: "assistant", content: "No se recibio contenido del modelo." },
        });
      }

      if (reqUrl.pathname === "/api/chat-stream") {
        await streamOllamaChat(res, history, model);
        return;
      }

      if (reqUrl.pathname === "/api/chat-agent") {
        const agentMode = parsed.agentMode !== false;
        if (!agentMode) {
          await streamOllamaChat(res, history, model);
          return;
        }

        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });

        const agentSystemPrompt =
          "Eres un asistente local experto con acceso a herramientas del sistema.\n" +
          "Reglas:\n" +
          "1. Tienes herramientas: web_fetch, run_command, read_file, write_file, list_directory, web_search.\n" +
          "2. Si vas a usar una herramienta, usa el formato EXACTO: (nombre_herramienta {\"arg\": \"val\"}).\n" +
          "3. INMEDIATAMENTE despues de escribir la herramienta, DETENTE. No alucines el resultado. El sistema te lo enviara.\n" +
          "4. Responde en español, preciso y sin excusas.";

        const conversationMessages = [{ role: "system", content: agentSystemPrompt }, ...history];
        let round = 0;
        let doneToolLoop = false;

        while (!doneToolLoop && round < config.MAX_TOOL_ROUNDS) {
          round++;
          let streamDone = false;
          let fullContent = "";
          let currentToolCalls = [];
          
          await new Promise((resolveRound, rejectRound) => {
            const requestBody = JSON.stringify({
              model,
              stream: true,
              messages: conversationMessages,
              tools: toolDefinitions,
            });

            const options = {
              hostname: config.OLLAMA_HOST,
              port: config.OLLAMA_PORT,
              path: "/api/chat",
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(requestBody),
              },
              agent: ollamaAgent,
            };

            const req = http.request(options, (ollamaRes) => {
              if (ollamaRes.statusCode !== 200) {
                let errData = "";
                ollamaRes.on("data", (chunk) => { errData += chunk; });
                ollamaRes.on("end", () => rejectRound(new Error(`Ollama HTTP ${ollamaRes.statusCode}: ${errData}`)));
                return;
              }

              ollamaRes.on("data", (chunk) => {
                const lines = chunk.toString().split("\n");
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const parsed = JSON.parse(line);
                    
                    if (parsed.message?.content) {
                      fullContent += parsed.message.content;
                      res.write(`${JSON.stringify({ type: "token", content: parsed.message.content })}\n`);
                    }

                    // Accumulate streaming tool calls
                    if (parsed.message?.tool_calls) {
                      parsed.message.tool_calls.forEach((tc, i) => {
                        if (!currentToolCalls[i]) currentToolCalls[i] = { function: { name: "", arguments: "" } };
                        if (tc.function.name) currentToolCalls[i].function.name += tc.function.name;
                        if (tc.function.arguments) currentToolCalls[i].function.arguments += tc.function.arguments;
                      });
                    }

                    if (parsed.done) {
                      streamDone = true;
                    }
                  } catch (e) {
                    logger.warn("Ollama JSON parse error en stream", { line });
                  }
                }
              });

              ollamaRes.on("end", () => resolveRound());
              ollamaRes.on("error", rejectRound);
            });

            req.on("error", rejectRound);
            req.setTimeout(config.OLLAMA_TIMEOUT_MS, () => req.destroy(new Error("Timeout esperando stream.")));
            req.write(requestBody);
            req.end();
          });

          // Check for fallback tool calls in the streamed text
          if (currentToolCalls.length === 0 && fullContent) {
            const toolRegex = /\(\s*([a-zA-Z0-9_]+)\s*(\{.*?\})\s*\)/s;
            const match = fullContent.match(toolRegex);
            if (match) {
              const name = match[1];
              if (toolDefinitions.some(t => t.function.name === name)) {
                try {
                  const argsText = match[2];
                  currentToolCalls = [{ function: { name, arguments: argsText } }];
                  fullContent = fullContent.substring(0, match.index).trim();
                } catch (e) {}
              }
            }
          }

          // Format native tool calls properly
          const finalToolCalls = currentToolCalls.map(tc => {
            try {
              return {
                function: {
                  name: tc.function.name,
                  arguments: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments
                }
              };
            } catch (e) {
              return null; // Ignore invalid JSON arguments
            }
          }).filter(Boolean);

          const assistantMsg = { role: "assistant", content: fullContent };
          if (finalToolCalls.length > 0) {
            assistantMsg.tool_calls = finalToolCalls;
            conversationMessages.push(assistantMsg);

            for (const toolCall of finalToolCalls) {
              const toolName = toolCall.function.name;
              const toolArgs = toolCall.function.arguments;
              
              logger.info(`Agente ejecutando herramienta: ${toolName}`);
              res.write(`${JSON.stringify({ type: "tool_call", name: toolName, arguments: toolArgs })}\n`);
              
              const toolResult = await executeTool(toolName, toolArgs);
              
              res.write(`${JSON.stringify({
                type: "tool_result",
                name: toolName,
                success: toolResult.success,
                content: toolResult.success ? toolResult.result : toolResult.error,
              })}\n`);

              conversationMessages.push({
                role: "tool",
                content: toolResult.success ? toolResult.result : `Error: ${toolResult.error}`,
              });
            }
          } else {
            // No tools used, loop is done
            conversationMessages.push(assistantMsg);
            doneToolLoop = true;
          }
        }

        if (!doneToolLoop) {
          res.write(`${JSON.stringify({ type: "token", content: "\n\n[Se alcanzo el limite de herramientas por turno]" })}\n`);
        }
        res.write(`${JSON.stringify({ type: "done", done: true })}\n`);
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: error.message });
      } else if (!res.writableEnded) {
        res.write(`${JSON.stringify({ type: "error", error: error.message })}\n`);
        res.end();
      }
    }
    return;
  }

  sendJson(res, 405, { error: "Metodo no permitido." });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.maxHeadersCount = 100;

server.listen(config.APP_PORT, config.HOST, () => {
  logger.info(`Interfaz lista en http://${config.HOST}:${config.APP_PORT}`);
  logger.info(`Ollama Backend: ${config.OLLAMA_HOST}:${config.OLLAMA_PORT} | Modelo Defecto: ${config.OLLAMA_MODEL}`);
});
