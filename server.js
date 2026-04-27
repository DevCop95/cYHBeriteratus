const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = "127.0.0.1";
const APP_PORT = Number(process.env.APP_PORT || 3000);
const OLLAMA_HOST = process.env.OLLAMA_HOST || "127.0.0.1";
const OLLAMA_PORT = Number(process.env.OLLAMA_PORT || 11434);
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 45000);
const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL || "huihui_ai/qwen3.5-abliterated:9b";

const publicDir = path.join(__dirname, "public");

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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function serveFile(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const safePath = path.normalize(path.join(publicDir, pathname));

  if (!safePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Ruta no permitida." });
    return;
  }

  fs.readFile(safePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Archivo no encontrado." });
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("La solicitud es demasiado grande."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function ollamaRequest(targetPath, payload) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify(payload);
    const req = http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: targetPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestBody),
        },
        timeout: OLLAMA_TIMEOUT_MS,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(raw || `Ollama devolvio ${res.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error("Respuesta invalida desde Ollama."));
          }
        });
      }
    );

    req.setTimeout(OLLAMA_TIMEOUT_MS, () => {
      req.destroy(new Error("Timeout esperando respuesta de Ollama."));
    });
    req.on("error", reject);
    req.write(requestBody);
    req.end();
  });
}

function ollamaGetTags() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: "/api/tags",
        method: "GET",
        timeout: 8000,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Ollama devolvio ${res.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error("No se pudo leer el estado de Ollama."));
          }
        });
      }
    );

    req.setTimeout(8000, () => {
      req.destroy(new Error("Timeout consultando estado de Ollama."));
    });
    req.on("error", reject);
    req.end();
  });
}

function streamOllamaChat(res, history) {
  return new Promise((resolve, reject) => {
    const systemPrompt =
      "Eres una interfaz local de asistencia tecnica. Responde de forma clara, breve y util.";
    const requestBody = JSON.stringify({
      model: OLLAMA_MODEL,
      stream: true,
      think: false,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
      ],
    });

    let settled = false;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const ollamaReq = http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestBody),
        },
        timeout: OLLAMA_TIMEOUT_MS,
      },
      (ollamaRes) => {
        if (ollamaRes.statusCode && ollamaRes.statusCode >= 400) {
          let raw = "";
          ollamaRes.setEncoding("utf8");
          ollamaRes.on("data", (chunk) => {
            raw += chunk;
          });
          ollamaRes.on("end", () => {
            finish(new Error(raw || `Ollama devolvio ${ollamaRes.statusCode}`));
          });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });

        let buffer = "";
        ollamaRes.setEncoding("utf8");

        ollamaRes.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }

            try {
              const parsed = JSON.parse(line);
              const token = parsed.message?.content;

              if (token) {
                res.write(`${JSON.stringify({ type: "token", content: token })}\n`);
              }

              if (parsed.done) {
                res.write(
                  `${JSON.stringify({
                    type: "done",
                    done: true,
                    doneReason: parsed.done_reason || "stop",
                  })}\n`
                );
                res.end();
                finish();
                return;
              }
            } catch (error) {
              res.write(
                `${JSON.stringify({
                  type: "error",
                  error: "Chunk invalido recibido desde Ollama.",
                })}\n`
              );
              res.end();
              finish(error);
              return;
            }
          }
        });

        ollamaRes.on("end", () => {
          if (!res.writableEnded) {
            if (buffer.trim()) {
              try {
                const parsed = JSON.parse(buffer);
                const token = parsed.message?.content;
                if (token) {
                  res.write(`${JSON.stringify({ type: "token", content: token })}\n`);
                }
              } catch {
                // Ignore trailing partial data on shutdown.
              }
            }

            res.write(`${JSON.stringify({ type: "done", done: true })}\n`);
            res.end();
            finish();
          }
        });

        ollamaRes.on("error", (error) => {
          if (!res.writableEnded) {
            res.write(
              `${JSON.stringify({
                type: "error",
                error: error.message,
              })}\n`
            );
            res.end();
          }
          finish(error);
        });
      }
    );

    ollamaReq.setTimeout(OLLAMA_TIMEOUT_MS, () => {
      ollamaReq.destroy(new Error("Timeout esperando stream de Ollama."));
    });

    const reqClose = () => {
      ollamaReq.destroy(new Error("Cliente desconectado."));
    };

    res.on("close", reqClose);
    ollamaReq.on("close", () => {
      res.off("close", reqClose);
    });
    ollamaReq.on("error", finish);
    ollamaReq.write(requestBody);
    ollamaReq.end();
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && reqUrl.pathname === "/api/status") {
    try {
      const tags = await ollamaGetTags();
      const models = Array.isArray(tags.models) ? tags.models : [];
      const modelLoaded = models.some((entry) => entry.name === OLLAMA_MODEL);

      sendJson(res, 200, {
        ok: true,
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        model: OLLAMA_MODEL,
        modelLoaded,
        availableModels: models.map((entry) => entry.name),
      });
    } catch (error) {
      sendJson(res, 503, {
        ok: false,
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        model: OLLAMA_MODEL,
        error: error.message,
      });
    }
    return;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/chat") {
    try {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const history = Array.isArray(parsed.messages) ? parsed.messages : [];
      const systemPrompt =
        "Eres una interfaz local de asistencia tecnica. Responde de forma clara, breve y util.";

      const response = await ollamaRequest("/api/chat", {
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
        ],
      });

      sendJson(res, 200, {
        ok: true,
        model: OLLAMA_MODEL,
        message: response.message || {
          role: "assistant",
          content: "No se recibio contenido del modelo.",
        },
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
      });
    }
    return;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/chat-stream") {
    try {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const history = Array.isArray(parsed.messages) ? parsed.messages : [];
      await streamOllamaChat(res, history);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, {
          ok: false,
          error: error.message,
        });
      } else if (!res.writableEnded) {
        res.write(`${JSON.stringify({ type: "error", error: error.message })}\n`);
        res.end();
      }
    }
    return;
  }

  if (req.method === "GET") {
    serveFile(req, res);
    return;
  }

  sendJson(res, 405, { error: "Metodo no permitido." });
});

server.listen(APP_PORT, HOST, () => {
  console.log(
    `Interfaz lista en http://${HOST}:${APP_PORT} | Ollama ${OLLAMA_HOST}:${OLLAMA_PORT} | Modelo ${OLLAMA_MODEL}`
  );
});
