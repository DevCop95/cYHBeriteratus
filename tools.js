const http = require("http");
const https = require("https");
const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");
const dns = require("dns").promises;

// ── Limits ──
const MAX_FETCH_BYTES = 8192;
const MAX_FILE_BYTES = 8192;
const MAX_CMD_OUTPUT = 4096;
const CMD_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;
const WORKSPACE_DIR = path.resolve(__dirname);

// Utility to check if IP is private (SSRF Protection)
function isPrivateIP(ip) {
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

// Utility to sandbox paths (Directory Traversal Protection)
function resolveSafePath(userPath) {
  const resolved = path.resolve(WORKSPACE_DIR, userPath);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    throw new Error(`Acceso denegado: La ruta está fuera del sandbox permitido (${WORKSPACE_DIR})`);
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
        "Perform a web search query and return a list of results (titles, snippets, and URLs). Use this instead of trying to web_fetch Google.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
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
  try {
    const targetUrl = new URL(url);
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      return { success: false, error: "Solo se permite http y https" };
    }

    const lookup = await dns.lookup(targetUrl.hostname);
    if (isPrivateIP(lookup.address)) {
      return { success: false, error: "Bloqueado: Intento de acceso a red interna (SSRF)" };
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
          resolve({ success: true, result: text.slice(0, MAX_FETCH_BYTES) });
        });
      });
      req.on("error", (err) => resolve({ success: false, error: err.message }));
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function toolWebSearch(args) {
  const { query } = args;
  if (!query) return { success: false, error: "Se requiere un parametro de busqueda." };

  try {
    return await new Promise((resolve) => {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const req = https.get(searchUrl, { timeout: FETCH_TIMEOUT_MS, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          // Parse DuckDuckGo HTML format
          const results = [];
          const regex = /<a class="result__url" href="([^"]+)">([^<]+)<\/a>[\s\S]*?<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          while ((match = regex.exec(raw)) !== null && results.length < 5) {
            const url = match[1];
            const urlText = match[2];
            const snippet = stripHtml(match[3]);
            results.push(`Título/URL: ${urlText}\nEnlace: ${url}\nResumen: ${snippet}\n`);
          }
          if (results.length === 0) {
            resolve({ success: true, result: stripHtml(raw).slice(0, MAX_FETCH_BYTES) });
          } else {
            resolve({ success: true, result: results.join("\n---\n") });
          }
        });
      });
      req.on("error", (err) => resolve({ success: false, error: err.message }));
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function toolRunCommand(args) {
  return new Promise((resolve) => {
    const { command } = args;
    if (!command) {
      resolve({ success: false, error: "No se especifico ningun comando." });
      return;
    }

    try {
      const output = execSync(command, {
        encoding: "utf8",
        timeout: CMD_TIMEOUT_MS,
        shell: "powershell.exe",
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        cwd: WORKSPACE_DIR,
      });

      let result = output || "(sin salida)";
      if (result.length > MAX_CMD_OUTPUT) {
        result = result.slice(0, MAX_CMD_OUTPUT) + "\n\n[... salida truncada ...]";
      }
      resolve({ success: true, result });
    } catch (err) {
      let errorMsg = err.stderr || err.stdout || err.message;
      if (errorMsg.length > MAX_CMD_OUTPUT) {
        errorMsg = errorMsg.slice(0, MAX_CMD_OUTPUT) + "\n\n[... error truncado ...]";
      }
      resolve({ success: false, error: errorMsg });
    }
  });
}

async function toolReadFile(args) {
  const { file_path } = args;
  if (!file_path) return { success: false, error: "No se especifico la ruta del archivo." };

  try {
    const safePath = resolveSafePath(file_path);
    const stat = await fs.stat(safePath);

    if (!stat.isFile()) {
      return { success: false, error: "La ruta no es un archivo." };
    }

    let content = await fs.readFile(safePath, "utf8");
    if (content.length > MAX_FILE_BYTES) {
      content = content.slice(0, MAX_FILE_BYTES) + "\n\n[... contenido truncado ...]";
    }
    return { success: true, result: content };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function toolWriteFile(args) {
  const { file_path, content } = args;
  if (!file_path || content === undefined) {
    return { success: false, error: "Se requiere file_path y content." };
  }

  try {
    const safePath = resolveSafePath(file_path);
    const dir = path.dirname(safePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(safePath, content, "utf8");
    return { success: true, result: `Archivo escrito exitosamente: ${safePath} (${content.length} bytes)` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function toolListDirectory(args) {
  const { dir_path } = args;
  if (!dir_path) return { success: false, error: "No se especifico la ruta del directorio." };

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

    return { success: true, result: result || "(directorio vacio)" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Tool executor map ──
const toolExecutors = {
  web_fetch: toolWebFetch,
  web_search: toolWebSearch,
  run_command: toolRunCommand,
  read_file: toolReadFile,
  write_file: toolWriteFile,
  list_directory: toolListDirectory,
};

async function executeTool(name, args) {
  const executor = toolExecutors[name];
  if (!executor) {
    return { success: false, error: `Herramienta desconocida: ${name}` };
  }

  try {
    return await executor(args);
  } catch (err) {
    return { success: false, error: `Error ejecutando ${name}: ${err.message}` };
  }
}

module.exports = {
  toolDefinitions,
  executeTool,
};
