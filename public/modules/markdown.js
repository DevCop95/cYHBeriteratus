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

export function renderMarkdown(raw) {
  if (!raw) return "";
  const src = escapeHtml(raw);
  const lines = src.split("\n");
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
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      const langLabel = `<span class="code-lang">${lang || "code"}</span>`;
      out.push(
        `<div class="code-header">${langLabel}<button class="code-copy-btn" data-copy>COPY</button></div>` +
        `<pre><code>${buf.join("\n")}</code></pre>`
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
