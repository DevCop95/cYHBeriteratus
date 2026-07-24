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

// ── Server-side session store ──
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_MESSAGES = 100;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.lastAccess < cutoff) sessions.delete(id);
  }
}, 60 * 60 * 1000).unref();

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
    sendJson(res, 403, { error: "Path not allowed." });
    return;
  }

  const ext = path.extname(safePath).toLowerCase();
  const mimeType = contentTypes[ext] || "application/octet-stream";
  applySecurityHeaders(res);

  // Always stat first so an edited file on disk invalidates the in-memory cache.
  fs.stat(safePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("404 Not Found");
    }

    const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
    const headers = { "Content-Type": mimeType, ETag: etag, "Cache-Control": "no-cache" };

    const cached = getCachedFile(safePath);
    if (cached && cached.etag === etag) {
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
        return res.end();
      }
      res.writeHead(200, headers);
      return res.end(cached.data);
    }

    fs.readFile(safePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end("500 Internal Server Error");
      }
      setCachedFile(safePath, data, stat);
      res.writeHead(200, headers);
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
          reject(new Error("Invalid Ollama response (not JSON)."));
        }
      });
    });

    ollamaReq.on("error", reject);
    ollamaReq.on("timeout", () => {
      ollamaReq.destroy(new Error("Timeout connecting to Ollama."));
    });

    if (payload) ollamaReq.write(JSON.stringify(payload));
    ollamaReq.end();
  });
}

// ── Shared Ollama streaming round (used by both chat-stream and agent loop) ──
function ollamaStreamRound(messages, tools, model, { onToken, onThinking, onRequest } = {}) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      model,
      stream: true,
      messages,
      ...(tools && { tools }),
      ...(config.OLLAMA_NUM_GPU !== null && { options: { num_gpu: config.OLLAMA_NUM_GPU } }),
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

    let fullContent = "";
    let fullThinking = "";
    const rawToolCalls = [];
    let settled = false;

    const settle = (err, val) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve(val);
    };

    const ollamaReq = http.request(options, (ollamaRes) => {
      if (ollamaRes.statusCode !== 200) {
        let errData = "";
        ollamaRes.on("data", (c) => { errData += c; });
        ollamaRes.on("end", () => settle(new Error(`Ollama HTTP ${ollamaRes.statusCode}: ${errData}`)));
        return;
      }

      ollamaRes.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.thinking) {
              fullThinking += parsed.message.thinking;
              onThinking?.(parsed.message.thinking);
            }
            if (parsed.message?.content) {
              fullContent += parsed.message.content;
              onToken?.(parsed.message.content);
            }
            if (parsed.message?.tool_calls) {
              parsed.message.tool_calls.forEach((tc, i) => {
                if (!rawToolCalls[i]) rawToolCalls[i] = { function: { name: "", arguments: "" } };
                if (tc.function.name) rawToolCalls[i].function.name += tc.function.name;
                if (tc.function.arguments) rawToolCalls[i].function.arguments += tc.function.arguments;
              });
            }
          } catch (e) {
            logger.warn("Ollama JSON parse error in stream", { line });
          }
        }
      });

      ollamaRes.on("end", () => settle(null, { fullContent, fullThinking, toolCalls: rawToolCalls }));
      ollamaRes.on("error", (err) => settle(err));
    });

    ollamaReq.setTimeout(config.OLLAMA_TIMEOUT_MS, () => ollamaReq.destroy(new Error("Timeout waiting for Ollama stream.")));
    onRequest?.(ollamaReq);
    ollamaReq.on("error", (err) => settle(err));
    ollamaReq.write(requestBody);
    ollamaReq.end();
  });
}

async function streamOllamaChat(res, messages, model) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });

  let reqRef = null;
  const cleanup = () => reqRef?.destroy(new Error("Client disconnected."));
  res.on("close", cleanup);

  try {
    await ollamaStreamRound(messages, null, model, {
      onToken: (content) => { if (!res.writableEnded) res.write(`${JSON.stringify({ type: "token", content })}\n`); },
      onThinking: (content) => { if (!res.writableEnded) res.write(`${JSON.stringify({ type: "thinking", content })}\n`); },
      onRequest: (req) => { reqRef = req; },
    });
    if (!res.writableEnded) res.write(`${JSON.stringify({ type: "done", done: true })}\n`);
  } catch (err) {
    if (!res.writableEnded) {
      logger.error("Stream error", { error: err.message });
      res.write(`${JSON.stringify({ type: "error", error: err.message })}\n`);
    }
  } finally {
    res.off("close", cleanup);
    if (!res.writableEnded) res.end();
  }
}

// ── HTTP Server Entrypoint ──
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && !reqUrl.pathname.startsWith("/api/")) {
    serveFile(req, res);
    return;
  }

  if (!rateLimiter(req, res)) return;

  // ── Session routes ──
  const sessionMatch = reqUrl.pathname.match(/^\/api\/session\/([^/]+)(\/sync)?$/);
  if (sessionMatch) {
    const sessionId = sessionMatch[1];
    const isSync = !!sessionMatch[2];

    if (!SESSION_ID_RE.test(sessionId)) {
      return sendJson(res, 400, { error: "Invalid session ID." });
    }

    if (req.method === "GET" && !isSync) {
      const session = sessions.get(sessionId);
      if (session) session.lastAccess = Date.now();
      return sendJson(res, 200, { messages: session?.messages ?? [] });
    }

    if (req.method === "POST" && isSync) {
      try {
        const body = await parseJsonBody(req, res);
        if (res.writableEnded) return;
        if (!Array.isArray(body.messages)) return sendJson(res, 400, { error: "'messages' must be an array." });
        sessions.set(sessionId, { messages: body.messages.slice(-SESSION_MAX_MESSAGES), lastAccess: Date.now() });
        return sendJson(res, 200, { ok: true });
      } catch { return; }
    }

    if (req.method === "DELETE" && !isSync) {
      sessions.delete(sessionId);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: "Method not allowed." });
  }

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
      logger.error("Error getting Ollama status", { error: error.message });
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
        const systemPrompt = "You are a local technical assistance interface. Answer clearly, briefly and usefully.";
        const response = await ollamaRequest("/api/chat", {
          model,
          stream: false,
          messages: [{ role: "system", content: systemPrompt }, ...history],
        });
        return sendJson(res, 200, {
          ok: true,
          model,
          message: response.message || { role: "assistant", content: "No content received from the model." },
        });
      }

      if (reqUrl.pathname === "/api/chat-stream") {
        await streamOllamaChat(res, history, model);
        return;
      }

      if (reqUrl.pathname === "/api/chat-agent") {
        const agentMode = parsed.agentMode !== false;
        const maxRounds = Math.min(20, Math.max(1, parseInt(parsed.maxRounds, 10) || config.MAX_TOOL_ROUNDS));
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
          "You are an expert local assistant with access to system tools.\n" +
          "Rules:\n" +
          "1. You have tools: web_fetch, run_command, read_file, write_file, list_directory, web_search, " +
          "dns_lookup, port_scan, http_headers, tls_info, hash_text. The security tools (port_scan, dns_lookup, " +
          "http_headers, tls_info) are for authorized red-team reconnaissance against a single target only.\n" +
          "2. To use a tool, use the EXACT format: (tool_name {\"arg\": \"val\"}).\n" +
          "3. IMMEDIATELY after writing the tool call, STOP. Do not hallucinate the result. The system will send it to you.\n" +
          "4. Answer precisely and without excuses.";

        const MAX_HISTORY = 20;
        const conversationMessages = [{ role: "system", content: agentSystemPrompt }, ...history];
        let round = 0;
        let doneToolLoop = false;
        let clientDisconnected = false;
        let currentRoundReq = null;
        let streamedAnything = false; // any visible token or tool output this turn
        res.on("close", () => {
          clientDisconnected = true;
          currentRoundReq?.destroy(new Error("Client disconnected."));
        });

        while (!doneToolLoop && !clientDisconnected && round < maxRounds) {
          round++;

          // Sliding window: keep system prompt + last MAX_HISTORY messages
          if (conversationMessages.length > MAX_HISTORY + 1) {
            conversationMessages.splice(1, conversationMessages.length - MAX_HISTORY - 1);
          }

          let roundResult;
          try {
            roundResult = await ollamaStreamRound(conversationMessages, toolDefinitions, model, {
              onToken: (content) => { streamedAnything = true; if (!res.writableEnded) res.write(`${JSON.stringify({ type: "token", content })}\n`); },
              onThinking: (content) => { if (!res.writableEnded) res.write(`${JSON.stringify({ type: "thinking", content })}\n`); },
              onRequest: (req) => { currentRoundReq = req; },
            });
          } catch (err) {
            if (!res.writableEnded) res.write(`${JSON.stringify({ type: "error", error: err.message })}\n`);
            if (!res.writableEnded) res.end();
            return;
          }

          if (clientDisconnected) break;

          let { fullContent, toolCalls: currentToolCalls } = roundResult;

          // Check for fallback tool calls in the streamed text
          if (currentToolCalls.length === 0 && fullContent) {
            const toolRegex = /\(\s*([a-zA-Z0-9_]+)\s*(\{.*?\})\s*\)/s;
            const match = fullContent.match(toolRegex);
            if (match) {
              const name = match[1];
              if (toolDefinitions.some(t => t.function.name === name)) {
                try {
                  currentToolCalls = [{ function: { name, arguments: match[2] } }];
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
                  arguments: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments,
                }
              };
            } catch (e) {
              return null;
            }
          }).filter(Boolean);

          const assistantMsg = { role: "assistant", content: fullContent };
          if (finalToolCalls.length > 0) {
            assistantMsg.tool_calls = finalToolCalls;
            conversationMessages.push(assistantMsg);

            for (const toolCall of finalToolCalls) {
              if (clientDisconnected) break;
              const toolName = toolCall.function.name;
              const toolArgs = toolCall.function.arguments;

              logger.info(`Agent executing tool: ${toolName}`);
              streamedAnything = true;
              if (!res.writableEnded) res.write(`${JSON.stringify({ type: "tool_call", name: toolName, arguments: toolArgs })}\n`);

              const toolResult = await executeTool(toolName, toolArgs);

              if (!res.writableEnded) res.write(`${JSON.stringify({
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
            conversationMessages.push(assistantMsg);
            doneToolLoop = true;
          }
        }

        if (!clientDisconnected && !doneToolLoop) {
          if (!res.writableEnded) res.write(`${JSON.stringify({ type: "token", content: "\n\n[Tool limit per turn reached]" })}\n`);
        }

        // Fallback: if the agent produced no visible output (e.g. a small model
        // that only emitted discarded reasoning, or got confused by the tool
        // prompt), answer once in plain chat mode so the user always gets a reply.
        if (!clientDisconnected && !streamedAnything) {
          try {
            await ollamaStreamRound(history, null, model, {
              onToken: (content) => { streamedAnything = true; if (!res.writableEnded) res.write(`${JSON.stringify({ type: "token", content })}\n`); },
              onThinking: (content) => { if (!res.writableEnded) res.write(`${JSON.stringify({ type: "thinking", content })}\n`); },
              onRequest: (req) => { currentRoundReq = req; },
            });
          } catch (err) {
            if (!res.writableEnded) res.write(`${JSON.stringify({ type: "error", error: err.message })}\n`);
          }
        }

        if (!res.writableEnded) {
          res.write(`${JSON.stringify({ type: "done", done: true })}\n`);
          res.end();
        }
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

  sendJson(res, 405, { error: "Method not allowed." });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.maxHeadersCount = 100;

server.listen(config.APP_PORT, config.HOST, () => {
  logger.info(`Interface ready at http://${config.HOST}:${config.APP_PORT}`);
  logger.info(`Ollama Backend: ${config.OLLAMA_HOST}:${config.OLLAMA_PORT} | Default Model: ${config.OLLAMA_MODEL}`);
});
