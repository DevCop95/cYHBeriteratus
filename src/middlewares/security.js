const logger = require("../utils/logger");

// Basic in-memory rate limiter (Token Bucket per IP)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

function rateLimiter(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  const record = requestCounts.get(ip);
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_LIMIT_WINDOW_MS;
    return true;
  }

  record.count++;
  if (record.count > MAX_REQUESTS_PER_WINDOW) {
    logger.warn("Rate limit excedido", { ip });
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Demasiadas peticiones. Intenta más tarde." }));
    return false;
  }

  return true;
}

// CSP Headers to prevent XSS
function applySecurityHeaders(res) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self';"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of requestCounts) {
    if (now > rec.resetTime) requestCounts.delete(ip);
  }
}, 5 * 60 * 1000);

module.exports = {
  rateLimiter,
  applySecurityHeaders,
};
