import { renderMarkdown } from "./markdown.js";

// ── DOM references ──
export const screen = document.getElementById("screen");
export const boot = document.getElementById("boot");
export const promptInput = document.getElementById("promptInput");
export const promptCursor = document.getElementById("promptCursor");
export const chatForm = document.getElementById("chatForm");
export const modelSelect = document.getElementById("modelSelect");
export const agentModeToggle = document.getElementById("agentModeToggle");
export const agentVal = document.getElementById("agentVal");
export const maxRoundsInput = document.getElementById("maxRoundsInput");
export const statusDot = document.getElementById("statusDot");
export const statusText = document.getElementById("statusText");
export const toastEl = document.getElementById("toast");

let toastTimer = null;

export function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2000);
}

export function hideBoot() {
  if (boot) boot.style.display = "none";
}

export function showBoot() {
  if (boot) boot.style.display = "";
}

function scrollToBottom() {
  screen.scrollTop = screen.scrollHeight;
}

function attachCopyHandlers(node) {
  node.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pre = btn.closest(".code-header")?.nextElementSibling;
      const code = pre?.querySelector("code")?.textContent ?? "";
      navigator.clipboard?.writeText(code).then(() => {
        btn.textContent = "copied";
        setTimeout(() => { btn.textContent = "copy"; }, 1200);
      });
    });
  });
}

// Build a transcript node for a stored/streamed entry.
export function createMessageNode(entry) {
  if (entry.role === "tool_call" || entry.role === "tool_result") {
    return createToolNode(entry);
  }
  if (entry.role === "user") {
    return createInputLine(entry);
  }
  return createOutputLine(entry);
}

function createInputLine(entry) {
  const line = document.createElement("div");
  line.className = "line line-in";
  const prompt = document.createElement("span");
  prompt.className = "prompt";
  prompt.textContent = "wrong@gpt:~$ ";
  const cmd = document.createElement("span");
  cmd.className = "cmd";
  cmd.textContent = entry.content;
  line.append(prompt, cmd);
  return line;
}

function createOutputLine(entry) {
  const line = document.createElement("div");
  line.className = "line line-out";

  // Optional collapsible "chain of thought"
  let thinkBody = null;
  const think = document.createElement("div");
  think.className = "think";
  think.style.display = "none";
  const toggle = document.createElement("span");
  toggle.className = "think-toggle";
  toggle.textContent = "[+] chain of thought";
  thinkBody = document.createElement("pre");
  thinkBody.className = "think-body";
  toggle.addEventListener("click", () => {
    const open = thinkBody.classList.toggle("show");
    toggle.textContent = `${open ? "[-]" : "[+]"} chain of thought`;
  });
  think.append(toggle, thinkBody);

  const out = document.createElement("div");
  out.className = "out";
  out.innerHTML = renderMarkdown(entry.content || "");
  attachCopyHandlers(out);

  line.append(think, out);
  line._bubble = out;
  line._think = think;
  line._thinkBody = thinkBody;
  return line;
}

function createToolNode(entry) {
  const line = document.createElement("div");
  line.className = "line line-tool";

  const head = document.createElement("div");
  head.className = "tool-head";
  const running = entry.role === "tool_call";
  head.innerHTML =
    `<span class="tool-key">[tool]</span> <span class="tool-name"></span> <span class="tool-dots">·······</span> `;
  head.querySelector(".tool-name").textContent = entry.name || "tool";
  const state = document.createElement("span");
  state.className = `tool-state ${running ? "spinner" : entry.success ? "success" : "error"}`;
  state.textContent = running ? "running" : entry.success ? "ok" : "error";
  head.append(state);

  const out = document.createElement("pre");
  out.className = "tool-out";
  if (entry.content) {
    out.textContent = entry.content;
  } else {
    out.style.display = "none";
  }

  line.append(head, out);
  line._state = state;
  line._out = out;
  return line;
}

// Streamed markdown into an assistant output line.
export function updateBubble(out, content) {
  out.innerHTML = renderMarkdown(content);
  attachCopyHandlers(out);
  scrollToBottom();
}

// Streamed reasoning into a line's thinking panel.
export function updateThinking(node, thinking) {
  if (!node._think || !node._thinkBody) return;
  node._thinkBody.textContent = thinking;
  node._think.style.display = "";
  scrollToBottom();
}

export function appendNode(node) {
  screen.appendChild(node);
  scrollToBottom();
  return node;
}

export function renderMessages(messages) {
  screen.querySelectorAll(".line").forEach((n) => n.remove());
  if (!messages.length) {
    showBoot();
  } else {
    hideBoot();
    messages.forEach((entry) => screen.appendChild(createMessageNode(entry)));
  }
  scrollToBottom();
}

export function setBusy(isBusy) {
  promptInput.disabled = isBusy;
  if (promptCursor) promptCursor.classList.toggle("hidden", isBusy);
}

export function setStatus({ ok, model, error, availableModels }, selectedModel) {
  if (ok) {
    statusDot.className = "status-dot";
    statusText.textContent = "online";
    const allModels = availableModels || [];
    if (allModels.length > 0) {
      const activeModel = selectedModel || model;
      modelSelect.replaceChildren(
        ...allModels.map((name) => {
          const opt = document.createElement("option");
          opt.value = name;
          // Shorten long model names for the status line
          opt.textContent = name.length > 34 ? name.slice(0, 32) + "…" : name;
          opt.title = name;
          opt.selected = name === activeModel;
          return opt;
        })
      );
      modelSelect.disabled = false;
      return selectedModel || model || allModels[0];
    }
    modelSelect.innerHTML = '<option value="">no models</option>';
    modelSelect.disabled = true;
  } else {
    statusDot.className = "status-dot offline";
    statusText.textContent = error ? "offline" : "no link";
    modelSelect.innerHTML = '<option value="">offline</option>';
    modelSelect.disabled = true;
    if (error) showToast(error);
  }
  return selectedModel;
}
