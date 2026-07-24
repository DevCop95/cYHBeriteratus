import { renderMarkdown } from "./markdown.js";

// ── DOM references ──
export const chat = document.getElementById("chat");
export const messagesEl = document.getElementById("messages");
export const welcome = document.getElementById("welcome");
export const promptInput = document.getElementById("promptInput");
export const sendBtn = document.getElementById("sendBtn");
export const chatForm = document.getElementById("chatForm");
export const modelSelect = document.getElementById("modelSelect");
export const agentToggle = document.getElementById("agentToggle");
export const agentVal = document.getElementById("agentVal");
export const roundsInput = document.getElementById("roundsInput");
export const newChatBtn = document.getElementById("newChat");
export const statusDot = document.getElementById("statusDot");
export const statusText = document.getElementById("statusText");
export const toastEl = document.getElementById("toast");
export const scrollBottomBtn = document.getElementById("scrollBottom");

const SKULL = "☠";

let toastTimer = null;

export function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

export function hideWelcome() { if (welcome) welcome.style.display = "none"; }
export function showWelcome() { if (welcome) welcome.style.display = "flex"; }

function scrollToBottom() { chat.scrollTop = chat.scrollHeight; }

function attachCopyHandlers(node) {
  node.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pre = btn.closest(".code-header")?.nextElementSibling;
      const code = pre?.querySelector("code")?.textContent ?? "";
      navigator.clipboard?.writeText(code).then(() => {
        btn.textContent = "Copied ✓";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1400);
      });
    });
  });
  node.querySelectorAll("[data-wrap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pre = btn.closest(".code-header")?.nextElementSibling;
      if (!pre) return;
      const on = pre.classList.toggle("wrap");
      btn.classList.toggle("active", on);
    });
  });
}

// Render tool output as text with clickable URLs. Escapes HTML first (XSS-safe),
// then wraps http(s) links in anchors — the only injected markup.
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function setToolOutput(el, text) {
  const escaped = String(text ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  el.innerHTML = escaped.replace(
    /(https?:\/\/[^\s<>"')]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

// ── Per-message hover actions (Copy / Regenerate / Edit) ──
const ICONS = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.58z"/></svg>',
  retry: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A8 8 0 1019.73 14h-2.08A6 6 0 116 12a6 6 0 016-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
};

function actionBtn(label, title, svg) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "msg-action";
  b.title = title;
  b.innerHTML = `${svg}<span>${label}</span>`;
  return b;
}

function buildActions(entry) {
  const bar = document.createElement("div");
  bar.className = "msg__actions";

  const copy = actionBtn("Copy", "Copy message", ICONS.copy);
  copy.addEventListener("click", () => {
    navigator.clipboard?.writeText(entry.content || "").then(() => {
      const span = copy.querySelector("span");
      const prev = span.textContent;
      span.textContent = "Copied";
      copy.classList.add("done");
      setTimeout(() => { span.textContent = prev; copy.classList.remove("done"); }, 1300);
    });
  });
  bar.append(copy);

  if (entry.role === "user") {
    const edit = actionBtn("Edit", "Edit & resend", ICONS.edit);
    edit.addEventListener("click", () => document.dispatchEvent(new CustomEvent("wg:edit", { detail: entry })));
    bar.append(edit);
  } else {
    const retry = actionBtn("Retry", "Regenerate response", ICONS.retry);
    retry.addEventListener("click", () => document.dispatchEvent(new CustomEvent("wg:regenerate", { detail: entry })));
    bar.append(retry);
  }
  return bar;
}

export function createMessageNode(entry) {
  if (entry.role === "tool_call" || entry.role === "tool_result") {
    return createToolNode(entry);
  }
  if (entry.role === "user") return createUserNode(entry);
  return createAssistantNode(entry);
}

function createUserNode(entry) {
  const msg = document.createElement("div");
  msg.className = "msg msg--user";
  const avatar = document.createElement("div");
  avatar.className = "msg__avatar";
  avatar.textContent = "YOU";
  const body = document.createElement("div");
  body.className = "msg__body";
  const content = document.createElement("div");
  content.className = "msg__content";
  content.textContent = entry.content;
  body.append(content, buildActions(entry));
  msg.append(avatar, body);
  msg._entry = entry;
  return msg;
}

function createAssistantNode(entry) {
  const msg = document.createElement("div");
  msg.className = "msg msg--assistant";

  const avatar = document.createElement("div");
  avatar.className = "msg__avatar";
  avatar.textContent = SKULL;

  const body = document.createElement("div");
  body.className = "msg__body";

  const role = document.createElement("div");
  role.className = "msg__role";
  role.textContent = "Wrong GPT";

  // Collapsible chain of thought
  const think = document.createElement("div");
  think.className = "think";
  think.style.display = "none";
  const toggle = document.createElement("span");
  toggle.className = "think__toggle";
  toggle.textContent = "▸ Show reasoning";
  const thinkBody = document.createElement("div");
  thinkBody.className = "think__body";
  toggle.addEventListener("click", () => {
    const open = thinkBody.classList.toggle("show");
    toggle.textContent = open ? "▾ Hide reasoning" : "▸ Show reasoning";
  });
  think.append(toggle, thinkBody);

  const content = document.createElement("div");
  content.className = "msg__content";
  content.innerHTML = entry.content ? renderMarkdown(entry.content) : '<span class="typing"><span></span><span></span><span></span></span>';
  attachCopyHandlers(content);

  const actions = buildActions(entry);
  body.append(role, think, content, actions);
  msg.append(avatar, body);
  msg._content = content;
  msg._think = think;
  msg._thinkBody = thinkBody;
  msg._actions = actions;
  msg._entry = entry;
  msg._started = !!entry.content;
  return msg;
}

function createToolNode(entry) {
  const msg = document.createElement("div");
  msg.className = "msg msg--assistant";
  const avatar = document.createElement("div");
  avatar.className = "msg__avatar";
  avatar.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>';
  const body = document.createElement("div");
  body.className = "msg__body";

  const card = document.createElement("div");
  card.className = "tool";
  const head = document.createElement("div");
  head.className = "tool__head";
  const running = entry.role === "tool_call";
  const name = document.createElement("span");
  name.className = "tool__name";
  name.textContent = entry.name || "tool";
  const state = document.createElement("span");
  state.className = `tool__state ${running ? "spinner" : entry.success ? "success" : "error"}`;
  state.textContent = running ? "running…" : entry.success ? "done" : "error";
  head.append(name, state);
  card.append(head);

  const out = document.createElement("div");
  out.className = "tool__out";
  if (entry.content) setToolOutput(out, entry.content);
  else out.style.display = "none";
  card.append(out);

  body.append(card);
  msg.append(avatar, body);
  msg._state = state;
  msg._out = out;
  return msg;
}

export function updateBubble(content, text) {
  content.innerHTML = renderMarkdown(text);
  attachCopyHandlers(content);
  scrollToBottom();
}

export function updateThinking(node, thinking) {
  if (!node._think || !node._thinkBody) return;
  node._thinkBody.textContent = thinking;
  node._think.style.display = "";
  scrollToBottom();
}

export function appendNode(node) {
  messagesEl.appendChild(node);
  scrollToBottom();
  return node;
}

export function renderMessages(messages) {
  messagesEl.replaceChildren();
  if (!messages.length) {
    showWelcome();
  } else {
    hideWelcome();
    messages.forEach((entry) => messagesEl.appendChild(createMessageNode(entry)));
  }
  scrollToBottom();
}

let busy = false;

export function setBusy(isBusy) {
  busy = isBusy;
  promptInput.disabled = isBusy;
  sendBtn.classList.toggle("is-stop", isBusy);
  sendBtn.title = isBusy ? "Stop generating" : "Send";
  updateSendState();
}

export function updateSendState() {
  // While generating, the button is a Stop control and stays clickable.
  sendBtn.disabled = busy ? false : promptInput.value.trim().length === 0;
}

// Blinking caret at the end of a streaming assistant message.
export function setStreaming(contentEl, on) {
  if (contentEl) contentEl.classList.toggle("streaming", on);
}

// Scroll-to-bottom pill: show it whenever the chat is scrolled away from the bottom.
export function initScrollBottom() {
  if (!chat || !scrollBottomBtn) return;
  const update = () => {
    const distance = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    scrollBottomBtn.classList.toggle("show", distance > 160);
  };
  chat.addEventListener("scroll", update, { passive: true });
  scrollBottomBtn.addEventListener("click", () => { chat.scrollTop = chat.scrollHeight; });
  update();
}

export function setStatus({ ok, model, error, availableModels }, selectedModel) {
  if (ok) {
    statusDot.className = "status__dot";
    statusText.textContent = "online";
    const allModels = availableModels || [];
    if (allModels.length > 0) {
      const activeModel = selectedModel || model;
      modelSelect.replaceChildren(
        ...allModels.map((name) => {
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          opt.selected = name === activeModel;
          return opt;
        })
      );
      modelSelect.disabled = false;
      return selectedModel || model || allModels[0];
    }
    modelSelect.innerHTML = '<option value="">No models</option>';
    modelSelect.disabled = true;
  } else {
    statusDot.className = "status__dot offline";
    statusText.textContent = "offline";
    modelSelect.innerHTML = '<option value="">Offline</option>';
    modelSelect.disabled = true;
    if (error) showToast(error);
  }
  return selectedModel;
}
