// Minimal, dependency-free Markdown renderer.
// CSP-safe: no CDN, no eval. Escapes HTML first, then applies a safe subset
// (code fences, inline code, bold/italic, links, headings, lists, blockquote, hr).

const CODE_OPEN = String.fromCharCode(0xe000);
const CODE_CLOSE = String.fromCharCode(0xe001);

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(text) {
  // Inline code first so its content is not further processed.
  // Wrap in private-use sentinels that cannot appear in escaped text.
  const codeSpans = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(`<code>${code}</code>`);
    return `${CODE_OPEN}${codeSpans.length - 1}${CODE_CLOSE}`;
  });

  // Links [text](url) — only http/https/mailto are allowed.
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");

  // Restore inline code spans.
  text = text.replace(new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, "g"), (_, i) => codeSpans[Number(i)]);
  return text;
}

// ── Minimal, CSP-safe syntax highlighter ──
// Hand-rolled scanner (no regex over escaped HTML, no external libs). It walks
// the RAW code and escapes every literal chunk as it emits token spans.
const KEYWORDS = {
  py: new Set("def class return if elif else for while import from as try except finally raise with lambda yield global nonlocal pass break continue in is not and or None True False del assert async await self print None".split(" ")),
  js: new Set("function var let const if else for while return class new this import from export default try catch finally throw switch case break continue typeof instanceof void delete yield async await null true false undefined of extends super static get set".split(" ")),
  shell: new Set("if then else elif fi for while do done case esac function return in echo cd export set local read exit sudo param foreach".split(" ")),
};

function langFamily(lang) {
  const l = (lang || "").toLowerCase();
  if (/^(py|python)/.test(l)) return "py";
  if (/^(sh|bash|shell|zsh|ps|ps1|powershell|bat|cmd)/.test(l)) return "shell";
  return "js"; // default: C-like (also fine for json/ts/generic)
}

function highlightCode(code, lang) {
  const em = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => s.replace(/[&<>"']/g, (c) => em[c]);
  const family = langFamily(lang);
  const keywords = KEYWORDS[family] || KEYWORDS.js;
  const hashComment = family === "py" || family === "shell";
  const isIdentStart = (c) => /[A-Za-z_$]/.test(c);
  const isIdent = (c) => /[A-Za-z0-9_$]/.test(c);

  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    // Line comments
    if ((hashComment && c === "#") || (!hashComment && c === "/" && code[i + 1] === "/")) {
      let j = code.indexOf("\n", i);
      if (j === -1) j = n;
      out += `<span class="tok-comment">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    // Block comments (C-like)
    if (!hashComment && c === "/" && code[i + 1] === "*") {
      let j = code.indexOf("*/", i + 2);
      j = j === -1 ? n : j + 2;
      out += `<span class="tok-comment">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    // Strings
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") { j += 2; continue; }
        if (code[j] === c) { j++; break; }
        j++;
      }
      out += `<span class="tok-string">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    // Numbers
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && /[0-9a-fA-Fx._]/.test(code[j])) j++;
      out += `<span class="tok-number">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    // Identifiers / keywords / function calls
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdent(code[j])) j++;
      const word = code.slice(i, j);
      let k = j;
      while (k < n && code[k] === " ") k++;
      if (keywords.has(word)) out += `<span class="tok-keyword">${esc(word)}</span>`;
      else if (code[k] === "(") out += `<span class="tok-function">${esc(word)}</span>`;
      else out += esc(word);
      i = j;
      continue;
    }
    out += esc(c);
    i++;
  }
  return out;
}

export function renderMarkdown(raw) {
  if (!raw) return "";
  const src = escapeHtml(raw);
  const lines = src.split("\n");
  const rawLines = raw.split("\n"); // parallel to `lines` (escaping never adds newlines)
  const out = [];
  let i = 0;
  let listType = null; // "ul" | "ol"

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block ```lang
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const lang = fence[1] || "";
      const rawBuf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { rawBuf.push(rawLines[i]); i++; }
      i++; // skip closing fence
      const codeRaw = rawBuf.join("\n");
      const highlighted = highlightCode(codeRaw, lang);
      const langLabel = `<span class="code-lang">${escapeHtml(lang) || "code"}</span>`;
      out.push(
        `<div class="code-block">` +
          `<div class="code-header">${langLabel}` +
            `<div class="code-actions">` +
              `<button class="code-btn" data-wrap type="button">Wrap</button>` +
              `<button class="code-btn code-copy-btn" data-copy type="button">Copy</button>` +
            `</div>` +
          `</div>` +
          `<pre><code>${highlighted}</code></pre>` +
        `</div>`
      );
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeList();
      out.push("<hr>");
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
      out.push(`<li>${inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`);
      i++;
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      i++;
      continue;
    }

    // Blank line
    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    // Paragraph (accumulate consecutive plain lines)
    closeList();
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join("<br>"))}</p>`);
  }

  closeList();
  return out.join("\n");
}
