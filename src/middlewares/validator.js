const logger = require("../utils/logger");

const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024; // 10MB limit for JSON

async function parseJsonBody(req, res) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > MAX_PAYLOAD_SIZE) {
        req.destroy(new Error("Payload too large"));
        logger.warn("Payload size excedido");
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large" }));
        reject(new Error("Payload too large"));
      }
    });
    
    req.on("end", () => {
      if (!body) {
        return resolve({});
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        logger.warn("Invalid JSON recibido");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "JSON malformado" }));
        reject(err);
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

function validateChatRequest(parsed) {
  if (parsed.messages && !Array.isArray(parsed.messages)) {
    return { valid: false, error: "'messages' debe ser un array" };
  }
  
  if (parsed.messages) {
    for (const msg of parsed.messages) {
      if (!msg.role || typeof msg.role !== "string") {
        return { valid: false, error: "Cada mensaje debe tener un 'role' válido" };
      }
    }
  }

  return { valid: true };
}

module.exports = {
  parseJsonBody,
  validateChatRequest,
};
