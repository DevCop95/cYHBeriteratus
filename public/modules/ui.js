import { renderMarkdown } from "./markdown.js";

// ── DOM references ──
export const chatContainer = document.getElementById("chatContainer");
export const welcomeScreen = document.getElementById("welcomeScreen");
export const typingIndicator = document.getElementById("typingIndicator");
export const progressBar = document.getElementById("progressBar");
export const promptInput = document.getElementById("promptInput");
export const sendButton = document.getElementById("sendButton");
export const clearButton = document.getElementById("clearButton");
export const modelSelect = document.getElementById("modelSelect");
export const agentModeToggle = document.getElementById("agentModeToggle");
export const maxRoundsInput = document.getElementById("maxRoundsInput");
export const statusBadge = document.getElementById("statusBadge");
export const statusDot = document.getElementById("statusDot");
export const statusText = document.getElementById("statusText");
export const toastEl = document.getElementById("toast");

const msgCountEl = document.getElementById("msgCount");
const sessionShortEl = document.getElementById("sessionShort");
const modelStatEl = document.getElementById("modelStat");
const modelSelectEl = modelSelect;
const healthDot = document.getElementById("healthDot");
const healthStatus = document.getElementById("healthStatus");
const footerModel = document.getElementById("footerModel");

const USER_ICON =
  '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
const BOT_ICON =
  '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>';
const TOOL_ICON =
  '<svg viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>';

let toastTimer = null;

export function formatTime(value = new Date()) {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

export function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2000);
}

export function hideWelcome() {
  if (welcomeScreen) welcomeScreen.style.display = "none";
}

export function showWelcome() {
  if (welcomeScreen) welcomeScreen.style.display = "flex";
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function attachCopyHandlers(node) {
  node.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pre = btn.closest(".code-header")?.nextElementSibling;
      const code = pre?.querySelector("code")?.textContent ?? "";
      navigator.clipboard?.writeText(code).then(() => {
        btn.textContent = "COPIED!";
        setTimeout(() => { btn.textContent = "COPY"; }, 1500);
      });
    });
  });
}

// Build a user or assistant chat bubble. Returns the bubble element so the
// caller can stream tokens into it.
export function createMessageNode(entry) {
  if (entry.role === "tool_call" || entry.role === "tool_result") {
    return createToolNode(entry);
  }

  const isUser = entry.role === "user";
  const message = document.createElement("div");
  message.className = `message ${isUser ? "user" : "assistant"}`;

  const label = document.createElement("div");
  label.className = "message-label";
  label.innerHTML = `${isUser ? USER_ICON : BOT_ICON} ${isUser ? "OPERATOR" : "WRONG GPT"}`;

  // Collapsible "chain of thought" section (assistant only, filled on demand).
  let reasoning = null;
  if (!isUser) {
    reasoning = document.createElement("div");
    reasoning.className = "reasoning-section";
    reasoning.style.display = "none";
    const toggle = document.createElement("span");
    toggle.className = "thinking-toggle";
    toggle.innerHTML = '<span class="toggle-arrow">▶</span> CHAIN OF THOUGHT';
    const content = document.createElement("div");
    content.className = "thinking-content";
    toggle.addEventListener("click", () => {
      content.classList.toggle("show");
      toggle.classList.toggle("open");
    });
    reasoning.append(toggle, content);
    message._thinking = content;
    message._reasoning = reasoning;
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  if (isUser) {
    bubble.textContent = entry.content;
  } else {
    bubble.innerHTML = renderMarkdown(entry.content || "");
    attachCopyHandlers(bubble);
  }

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const time = document.createElement("span");
  time.textContent = entry.time || formatTime();
  const copy = document.createElement("button");
  copy.className = "copy-btn";
  copy.textContent = "COPY";
  copy.addEventListener("click", () => {
    navigator.clipboard?.writeText(bubble.textContent).then(() => showToast("Copied"));
  });
  meta.append(time, copy);

  if (reasoning) {
    message.append(label, reasoning, bubble, meta);
  } else {
    message.append(label, bubble, meta);
  }
  message._bubble = bubble;
  return message;
}

// Append streamed reasoning text to an assistant node's thinking panel.
export function updateThinking(node, thinking) {
  if (!node._thinking || !node._reasoning) return;
  node._thinking.textContent = thinking;
  node._reasoning.style.display = "";
  scrollToBottom();
}

function createToolNode(entry) {
  const message = document.createElement("div");
  message.className = "message tool";

  const card = document.createElement("div");
  card.className = "tool-card";

  const label = document.createElement("div");
  label.className = "message-label";
  label.innerHTML = `${TOOL_ICON} SYSTEM`;

  const header = document.createElement("div");
  header.className = "tool-header";
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = entry.name || "tool";
  const status = document.createElement("span");
  const running = entry.role === "tool_call";
  status.className = `tool-status ${running ? "spinner" : entry.success ? "success" : "error"}`;
  status.textContent = running ? "Running..." : entry.success ? "Done" : "Error";
  header.append(name, status);

  const result = document.createElement("pre");
  result.className = "tool-result";
  if (entry.content) {
    result.textContent = entry.content;
  } else {
    result.style.display = "none";
  }

  card.append(label, header, result);
  message.append(card);
  message._status = status;
  message._result = result;
  return message;
}

// Set the streamed markdown content of an assistant bubble.
export function updateBubble(bubble, content) {
  bubble.innerHTML = renderMarkdown(content);
  attachCopyHandlers(bubble);
  scrollToBottom();
}

export function appendNode(node) {
  chatContainer.appendChild(node);
  scrollToBottom();
  return node;
}

export function renderMessages(messages) {
  chatContainer.querySelectorAll(".message").forEach((n) => n.remove());
  if (!messages.length) {
    showWelcome();
  } else {
    hideWelcome();
    messages.forEach((entry) => chatContainer.appendChild(createMessageNode(entry)));
  }
  scrollToBottom();
}

export function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  promptInput.disabled = isBusy;
  typingIndicator.classList.toggle("show", isBusy);
  progressBar.classList.toggle("active", isBusy);
  if (isBusy) {
    // Keep the typing indicator at the very bottom of the log.
    chatContainer.appendChild(typingIndicator);
    scrollToBottom();
  }
}

export function updateStats({ count, sessionId, model }) {
  if (count !== undefined) msgCountEl.textContent = count;
  if (sessionId !== undefined) sessionShortEl.textContent = sessionId.slice(0, 8);
  if (model !== undefined) {
    modelStatEl.textContent = model || "-";
    footerModel.textContent = model ? `${model} via Ollama` : "local model via Ollama";
  }
}

export function setStatus({ ok, model, error, availableModels }, selectedModel) {
  if (ok) {
    statusBadge.classList.add("online");
    statusDot.className = "status-dot";
    statusText.textContent = "ONLINE";
    healthDot.className = "health-dot online";
    healthStatus.textContent = "Online";

    const allModels = availableModels || [];
    if (allModels.length > 0) {
      const activeModel = selectedModel || model;
      modelSelectEl.replaceChildren(
        ...allModels.map((name) => {
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          opt.selected = name === activeModel;
          return opt;
        })
      );
      modelSelectEl.disabled = false;
      const active = selectedModel || model || allModels[0];
      updateStats({ model: active });
      return active;
    }
    modelSelectEl.innerHTML = '<option value="">No models installed</option>';
    modelSelectEl.disabled = true;
  } else {
    statusBadge.classList.remove("online");
    statusDot.className = "status-dot offline";
    statusText.textContent = error ? "OFFLINE" : "LINK DOWN";
    healthDot.className = "health-dot offline";
    healthStatus.textContent = "Offline";
    modelSelectEl.innerHTML = '<option value="">No connection</option>';
    modelSelectEl.disabled = true;
    if (error) showToast(error);
  }
  return selectedModel;
}
