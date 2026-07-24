const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");
const { execFile } = require("child_process");
const dns = require("dns").promises;

// ── Limits ──
const MAX_FETCH_BYTES = 8192;
const MAX_FILE_BYTES = 8192;
const MAX_CMD_OUTPUT = 4096;
const CMD_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;
const WORKSPACE_DIR = path.resolve(__dirname);

// ── Security-recon limits (single-host, authorized-testing scope) ──
const PORTSCAN_MAX_PORTS = 1024;   // hard cap per scan — no mass sweeps
const PORTSCAN_CONCURRENCY = 64;   // simultaneous connect attempts
const PORTSCAN_TIMEOUT_MS = 1200;  // per-port connect timeout

// Well-known TCP ports → service name (for readable scan output)
const COMMON_PORTS = {
  21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns", 80: "http",
  110: "pop3", 111: "rpcbind", 135: "msrpc", 139: "netbios-ssn", 143: "imap",
  161: "snmp", 389: "ldap", 443: "https", 445: "smb", 465: "smtps", 587: "submission",
  636: "ldaps", 993: "imaps", 995: "pop3s", 1433: "mssql", 1521: "oracle",
  2049: "nfs", 2375: "docker", 3000: "http-dev", 3306: "mysql", 3389: "rdp",
  5432: "postgres", 5900: "vnc", 5985: "winrm", 6379: "redis", 8000: "http-alt",
  8080: "http-proxy", 8443: "https-alt", 9200: "elasticsearch", 11211: "memcached",
  27017: "mongodb",
};

// Parse a port specification into a bounded list of port numbers.
// Accepts: array of numbers, a single number, "common", "N-M" range, or "a,b,c" list.
function parsePorts(spec) {
  if (Array.isArray(spec)) return spec.map(Number).filter((n) => n > 0 && n <= 65535);
  if (typeof spec === "number") return spec > 0 && spec <= 65535 ? [spec] : [];
  const s = String(spec == null ? "common" : spec).trim().toLowerCase();
  if (s === "" || s === "common") return Object.keys(COMMON_PORTS).map(Number);
  const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    let a = Number(range[1]), b = Number(range[2]);
    if (a > b) [a, b] = [b, a];
    const out = [];
    for (let p = Math.max(1, a); p <= Math.min(65535, b); p++) out.push(p);
    return out;
  }
  return s.split(",").map((x) => parseInt(x, 10)).filter((n) => n > 0 && n <= 65535);
}

// Normalize user input to a bare hostname/IP (strip scheme, path, port, CIDR guard elsewhere).
function extractHost(input) {
  return String(input).trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").split(":")[0];
}

// ── In-memory fetch/search cache (60s TTL) ──
const fetchCache = new Map();
const FETCH_CACHE_TTL_MS = 60000;

function getCachedFetch(key) {
  const entry = fetchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { fetchCache.delete(key); return null; }
  return entry.result;
}

function setCachedFetch(key, result) {
  if (fetchCache.size >= 100) fetchCache.delete(fetchCache.keys().next().value);
  fetchCache.set(key, { result, expiry: Date.now() + FETCH_CACHE_TTL_MS });
}

// Check whether an IP is private (SSRF protection)
function isPrivateIP(ip) {
  // IPv6 loopback and private/link-local ranges
  if (ip === "::1" || ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80") || ip.startsWith("::ffff:")) return true;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127 ||
    parts[0] === 169 ||
    parts[0] === 0
  );
}

// Sandbox user-supplied paths (directory traversal protection)
function resolveSafePath(userPath) {
  const resolved = path.resolve(WORKSPACE_DIR, userPath);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    throw new Error(`Access denied: path is outside the allowed sandbox (${WORKSPACE_DIR})`);
  }
  return resolved;
}

// ──────────────────────────────────────────────
//  Tool definitions (OpenAI-compatible format)
// ──────────────────────────────────────────────
const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch and read the text content of a web page given its URL. Returns plain text extracted from HTML. Use this to browse the web, read articles, documentation, or any public URL. Do NOT use this to search google.com.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full URL to fetch (must start with http:// or https://)",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Perform a web search and return a numbered list of results with the page title, a clean direct URL, and a snippet. Use this instead of trying to web_fetch Google.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
          max_results: {
            type: "number",
            description: "How many results to return (1-10, default 5).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Execute a shell command on the local Windows system using PowerShell. Returns the stdout and stderr output. Use this to run scripts, check system info, install software, etc.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to execute in PowerShell",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file from the local filesystem. Returns the text content of the file.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file to read",
          },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write content to a file on the local filesystem. Creates the file and any intermediate directories if they don't exist. Overwrites the file if it already exists.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file to write",
          },
          content: {
            type: "string",
            description: "The content to write to the file",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List the contents of a directory on the local filesystem. Returns file names, types (file/directory), and sizes.",
      parameters: {
        type: "object",
        properties: {
          dir_path: {
            type: "string",
            description: "Absolute path to the directory to list",
          },
        },
        required: ["dir_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dns_lookup",
      description:
        "Resolve DNS records for a domain (recon / OSINT). Returns the requested record type, or a summary of A, AAAA, MX, TXT, NS and CNAME records when no type is given.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "The domain name to resolve, e.g. example.com" },
          record_type: {
            type: "string",
            description: "Optional record type: A, AAAA, MX, TXT, NS, CNAME, SOA. Omit to fetch all common types.",
          },
        },
        required: ["domain"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "port_scan",
      description:
        "TCP connect scan of a SINGLE authorized host. Reports which ports are open with their likely service. For authorized reconnaissance only — single host, no network/CIDR ranges. Ports are capped per scan.",
      parameters: {
        type: "object",
        properties: {
          host: { type: "string", description: "A single hostname or IP address to scan" },
          ports: {
            type: "string",
            description:
              "Ports to scan: 'common' (default, ~40 well-known ports), a range like '1-1024', or a comma list like '22,80,443'.",
          },
        },
        required: ["host"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "http_headers",
      description:
        "Fetch the HTTP response status and headers for a URL and produce a security-header audit (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) plus any exposed server banners. Defensive posture check.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full http:// or https:// URL to inspect" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tls_info",
      description:
        "Inspect the TLS/SSL certificate presented by a host: subject, issuer, validity dates, days until expiry, negotiated protocol and Subject Alternative Names. Useful for certificate hygiene and recon.",
      parameters: {
        type: "object",
        properties: {
          host: { type: "string", description: "Hostname or IP to connect to" },
          port: { type: "number", description: "TLS port (default 443)" },
        },
        required: ["host"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hash_text",
      description:
        "Compute cryptographic hashes of a text string. Returns md5, sha1, sha256 and sha512 by default, or a single algorithm if specified. Useful for integrity checks and CTF work.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to hash" },
          algorithm: {
            type: "string",
            description: "Optional single algorithm, e.g. md5, sha1, sha256, sha512. Omit for all common ones.",
          },
        },
        required: ["text"],
      },
    },
  },
];

// ──────────────────────────────────────────────
//  Tool implementations
// ──────────────────────────────────────────────

function stripHtml(html) {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

async function toolWebFetch(args) {
  const { url } = args;
  const cached = getCachedFetch(url);
  if (cached) return cached;
  try {
    const targetUrl = new URL(url);
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      return { success: false, error: "Only http and https are allowed" };
    }

    const lookup = await dns.lookup(targetUrl.hostname);
    if (isPrivateIP(lookup.address)) {
      return { success: false, error: "Blocked: attempt to access internal network (SSRF)" };
    }

    return await new Promise((resolve) => {
      const client = url.startsWith("https") ? https : http;
      const req = client.get(url, { timeout: FETCH_TIMEOUT_MS, headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(toolWebFetch({ url: new URL(res.headers.location, url).href }));
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const text = res.headers["content-type"]?.includes("html") ? stripHtml(raw) : raw;
          const fetchResult = { success: true, result: text.slice(0, MAX_FETCH_BYTES) };
          setCachedFetch(url, fetchResult);
          resolve(fetchResult);
        });
      });
      req.on("error", (err) => resolve({ success: false, error: err.message }));
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Decode a DuckDuckGo HTML redirect (//duckduckgo.com/l/?uddg=ENC&rut=...) to the clean target URL.
function decodeDdgUrl(href) {
  if (!href) return "";
  const cleaned = href.replace(/&amp;/g, "&");
  const m = cleaned.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { /* fall through */ }
  }
  if (cleaned.startsWith("//")) return "https:" + cleaned;
  return cleaned;
}

async function toolWebSearch(args) {
  const { query } = args;
  if (!query) return { success: false, error: "A search query is required." };

  const max = Math.min(Math.max(parseInt(args.max_results, 10) || 5, 1), 10);
  const cacheKey = `search:${max}:${query}`;
  const cached = getCachedFetch(cacheKey);
  if (cached) return cached;

  const fetchDDG = (url) => new Promise((resolve) => {
    const req = https.get(url, { timeout: FETCH_TIMEOUT_MS, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchDDG(new URL(res.headers.location, url).href));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ ok: true, raw: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
  });

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const fetched = await fetchDDG(searchUrl);
    if (!fetched.ok) return { success: false, error: fetched.error };

    const raw = fetched.raw;
    const results = [];
    const seen = new Set();

    const addResult = (title, url, snippet) => {
      if (!url || url.includes("duckduckgo.com") || seen.has(url)) return;
      seen.add(url);
      const heading = title && title !== url ? title : url;
      const parts = [`${results.length + 1}. ${heading}`, `   ${url}`];
      if (snippet) parts.push(`   ${snippet}`);
      results.push(parts.join("\n"));
    };

    // Primary: the result title anchor (real page title + link) followed by its snippet.
    const primary = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = primary.exec(raw)) !== null && results.length < max) {
      addResult(stripHtml(m[2]).trim(), decodeDdgUrl(m[1]), stripHtml(m[3]).trim());
    }

    // Fallback 1: title anchors only (layout without a matched snippet).
    if (results.length === 0) {
      const titleOnly = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((m = titleOnly.exec(raw)) !== null && results.length < max) {
        addResult(stripHtml(m[2]).trim(), decodeDdgUrl(m[1]), "");
      }
    }

    // Fallback 2: any external/redirect link with meaningful anchor text.
    if (results.length === 0) {
      const linkRegex = /<a[^>]+href="(\/\/duckduckgo\.com\/l\/\?uddg=[^"]+|https?:\/\/[^"]+)"[^>]*>([^<]{10,})<\/a>/gi;
      while ((m = linkRegex.exec(raw)) !== null && results.length < max) {
        addResult(stripHtml(m[2]).trim(), decodeDdgUrl(m[1]), "");
      }
    }

    if (results.length === 0) {
      return { success: false, error: "No results found (DuckDuckGo returned nothing parseable)." };
    }

    const searchResult = { success: true, result: `Search results for "${query}":\n\n` + results.join("\n\n") };
    setCachedFetch(cacheKey, searchResult);
    return searchResult;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function toolRunCommand(args) {
  const { command } = args;
  if (!command) return Promise.resolve({ success: false, error: "No command specified." });

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        timeout: CMD_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        cwd: WORKSPACE_DIR,
      },
      (err, stdout, stderr) => {
        if (err) {
          let errorMsg = stderr || stdout || err.message;
          if (errorMsg.length > MAX_CMD_OUTPUT) errorMsg = errorMsg.slice(0, MAX_CMD_OUTPUT) + "\n\n[... error truncated ...]";
          resolve({ success: false, error: errorMsg });
        } else {
          let result = stdout || "(no output)";
          if (result.length > MAX_CMD_OUTPUT) result = result.slice(0, MAX_CMD_OUTPUT) + "\n\n[... output truncated ...]";
          resolve({ success: true, result });
        }
      }
    );
  });
}

async function toolReadFile(args) {
  const { file_path } = args;
  if (!file_path) return { success: false, error: "No file path specified." };

  try {
    const safePath = resolveSafePath(file_path);
    const stat = await fs.stat(safePath);

    if (!stat.isFile()) {
      return { success: false, error: "The path is not a file." };
    }

    let content = await fs.readFile(safePath, "utf8");
    if (content.length > MAX_FILE_BYTES) {
      content = content.slice(0, MAX_FILE_BYTES) + "\n\n[... content truncated ...]";
    }
    return { success: true, result: content };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function toolWriteFile(args) {
  const { file_path, content } = args;
  if (!file_path || content === undefined) {
    return { success: false, error: "file_path and content are required." };
  }

  try {
    const safePath = resolveSafePath(file_path);
    const dir = path.dirname(safePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(safePath, content, "utf8");
    return { success: true, result: `File written successfully: ${safePath} (${content.length} bytes)` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function toolListDirectory(args) {
  const { dir_path } = args;
  if (!dir_path) return { success: false, error: "No directory path specified." };

  try {
    const safePath = resolveSafePath(dir_path);
    const entries = await fs.readdir(safePath, { withFileTypes: true });
    
    const items = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(safePath, entry.name);
        if (entry.isDirectory()) {
          return { name: entry.name, type: "directory" };
        }
        try {
          const stat = await fs.stat(fullPath);
          return { name: entry.name, type: "file", size: stat.size };
        } catch {
          return { name: entry.name, type: "file", size: "?" };
        }
      })
    );

    const result = items
      .map((item) => {
        if (item.type === "directory") return `[DIR]  ${item.name}`;
        const sizeStr =
          item.size === "?"
            ? "?"
            : item.size > 1024 * 1024
            ? `${(item.size / (1024 * 1024)).toFixed(1)} MB`
            : item.size > 1024
            ? `${(item.size / 1024).toFixed(1)} KB`
            : `${item.size} B`;
        return `[FILE] ${item.name} (${sizeStr})`;
      })
      .join("\n");

    return { success: true, result: result || "(empty directory)" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Security recon tools ──

async function toolDnsLookup(args) {
  const { domain, record_type } = args;
  if (!domain) return { success: false, error: "A domain is required." };
  const host = extractHost(domain);
  if (!host) return { success: false, error: "Invalid domain." };

  const types = record_type
    ? [String(record_type).toUpperCase()]
    : ["A", "AAAA", "MX", "TXT", "NS", "CNAME"];

  const out = [];
  for (const t of types) {
    try {
      const recs = await dns.resolve(host, t);
      const flat = recs
        .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
        .join(", ");
      out.push(`${t}: ${flat || "(empty)"}`);
    } catch (err) {
      // Raw DNS (port 53) may be blocked; fall back to the OS resolver for address records.
      if ((t === "A" || t === "AAAA") && (err.code === "ECONNREFUSED" || err.code === "ETIMEOUT")) {
        try {
          const family = t === "AAAA" ? 6 : 4;
          const addrs = await dns.lookup(host, { all: true, family });
          out.push(`${t}: ${addrs.map((a) => a.address).join(", ") || "(empty)"} (via OS resolver)`);
          continue;
        } catch { /* fall through to failure handling */ }
      }
      if (record_type) return { success: false, error: `${t} lookup failed: ${err.code || err.message}` };
      out.push(`${t}: (none)`);
    }
  }
  return { success: true, result: `DNS records for ${host}:\n` + out.join("\n") };
}

async function toolPortScan(args) {
  const { host, ports } = args;
  if (!host) return { success: false, error: "A host is required." };
  if (String(host).includes("/")) {
    return { success: false, error: "CIDR/network ranges are not supported. Scan a single host only." };
  }

  const target = extractHost(host);
  if (!target) return { success: false, error: "Invalid host." };

  const portList = parsePorts(ports);
  if (portList.length === 0) return { success: false, error: "No valid ports to scan." };
  if (portList.length > PORTSCAN_MAX_PORTS) {
    return { success: false, error: `Too many ports (${portList.length}). Maximum is ${PORTSCAN_MAX_PORTS} per scan.` };
  }

  let address;
  try {
    address = (await dns.lookup(target)).address;
  } catch (err) {
    return { success: false, error: `Cannot resolve host: ${err.message}` };
  }

  const open = [];
  let cursor = 0;
  async function worker() {
    while (cursor < portList.length) {
      const port = portList[cursor++];
      const isOpen = await new Promise((resolve) => {
        const sock = new net.Socket();
        let settled = false;
        const finish = (v) => { if (settled) return; settled = true; sock.destroy(); resolve(v); };
        sock.setTimeout(PORTSCAN_TIMEOUT_MS);
        sock.once("connect", () => finish(true));
        sock.once("timeout", () => finish(false));
        sock.once("error", () => finish(false));
        sock.connect(port, address);
      });
      if (isOpen) open.push(port);
    }
  }

  const pool = Array.from({ length: Math.min(PORTSCAN_CONCURRENCY, portList.length) }, worker);
  await Promise.all(pool);
  open.sort((a, b) => a - b);

  const lines = open.length
    ? open.map((p) => `  ${String(p).padStart(5)}/tcp  open   ${COMMON_PORTS[p] || "unknown"}`).join("\n")
    : "  (no open ports found)";
  return {
    success: true,
    result: `Scan of ${target} (${address}) — ${portList.length} ports checked, ${open.length} open:\n${lines}`,
  };
}

async function toolHttpHeaders(args) {
  const { url } = args;
  if (!url) return { success: false, error: "A URL is required." };

  let target;
  try {
    target = new URL(url);
  } catch {
    return { success: false, error: "Invalid URL." };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { success: false, error: "Only http and https are allowed." };
  }

  return await new Promise((resolve) => {
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      { method: "GET", timeout: FETCH_TIMEOUT_MS, headers: { "User-Agent": "Mozilla/5.0" } },
      (res) => {
        res.destroy(); // headers only — no need for the body
        const h = res.headers;
        const lines = [`HTTP ${res.statusCode} ${res.statusMessage || ""}`.trim()];
        for (const [k, v] of Object.entries(h)) lines.push(`${k}: ${v}`);

        const wanted = {
          "strict-transport-security": "HSTS (Strict-Transport-Security)",
          "content-security-policy": "Content-Security-Policy",
          "x-frame-options": "X-Frame-Options (clickjacking)",
          "x-content-type-options": "X-Content-Type-Options (MIME sniffing)",
          "referrer-policy": "Referrer-Policy",
          "permissions-policy": "Permissions-Policy",
        };
        const audit = Object.entries(wanted).map(([key, label]) =>
          h[key] ? `  [+] ${label}` : `  [-] ${label} — MISSING`
        );
        if (h["server"]) audit.push(`  [i] Server banner exposed: ${h["server"]}`);
        if (h["x-powered-by"]) audit.push(`  [i] X-Powered-By exposed: ${h["x-powered-by"]}`);

        resolve({
          success: true,
          result: lines.join("\n") + "\n\nSecurity header audit:\n" + audit.join("\n"),
        });
      }
    );
    req.on("timeout", () => { req.destroy(); resolve({ success: false, error: "Request timed out." }); });
    req.on("error", (err) => resolve({ success: false, error: err.message }));
    req.end();
  });
}

async function toolTlsInfo(args) {
  const { host, port } = args;
  if (!host) return { success: false, error: "A host is required." };
  const target = extractHost(host);
  const p = Number(port) || 443;

  return await new Promise((resolve) => {
    const sock = tls.connect(
      { host: target, port: p, servername: target, timeout: FETCH_TIMEOUT_MS, rejectUnauthorized: false },
      () => {
        const cert = sock.getPeerCertificate();
        const proto = sock.getProtocol();
        const authorized = sock.authorized;
        const authError = sock.authorizationError;
        sock.end();
        if (!cert || !cert.subject) return resolve({ success: false, error: "No certificate returned." });

        const daysLeft = Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
        const san = (cert.subjectaltname || "").replace(/DNS:/g, "");
        const cn = (obj) => (obj && obj.CN ? obj.CN : JSON.stringify(obj));
        const expiryNote = daysLeft < 0 ? " (EXPIRED)" : daysLeft < 15 ? " (EXPIRING SOON)" : "";

        resolve({
          success: true,
          result: [
            `Host: ${target}:${p}`,
            `TLS protocol: ${proto}`,
            `Chain trusted: ${authorized ? "yes" : `no${authError ? ` (${authError})` : ""}`}`,
            `Subject: ${cn(cert.subject)}`,
            `Issuer: ${cn(cert.issuer)}`,
            `Valid from: ${cert.valid_from}`,
            `Valid to:   ${cert.valid_to}`,
            `Days until expiry: ${daysLeft}${expiryNote}`,
            `SANs: ${san || "(none)"}`,
            `Serial: ${cert.serialNumber || "(n/a)"}`,
          ].join("\n"),
        });
      }
    );
    sock.on("timeout", () => { sock.destroy(); resolve({ success: false, error: "TLS connection timed out." }); });
    sock.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

function toolHashText(args) {
  const { text, algorithm } = args;
  if (text === undefined || text === null) return { success: false, error: "text is required." };

  const supported = new Set(crypto.getHashes());
  const algos = algorithm ? [String(algorithm).toLowerCase()] : ["md5", "sha1", "sha256", "sha512"];

  const out = [];
  for (const a of algos) {
    if (!supported.has(a)) { out.push(`${a}: (unsupported algorithm)`); continue; }
    out.push(`${a}: ${crypto.createHash(a).update(String(text)).digest("hex")}`);
  }
  return { success: true, result: out.join("\n") };
}

// ── Tool executor map ──
const toolExecutors = {
  web_fetch: toolWebFetch,
  web_search: toolWebSearch,
  run_command: toolRunCommand,
  read_file: toolReadFile,
  write_file: toolWriteFile,
  list_directory: toolListDirectory,
  dns_lookup: toolDnsLookup,
  port_scan: toolPortScan,
  http_headers: toolHttpHeaders,
  tls_info: toolTlsInfo,
  hash_text: toolHashText,
};

async function executeTool(name, args) {
  const executor = toolExecutors[name];
  if (!executor) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  try {
    return await executor(args);
  } catch (err) {
    return { success: false, error: `Error executing ${name}: ${err.message}` };
  }
}

module.exports = {
  toolDefinitions,
  executeTool,
  isPrivateIP,
  parsePorts,
  extractHost,
};
