import { getOrCreateSessionId, loadMessages, saveMessages, restoreSession, syncSession, clearSession } from "./modules/session.js";
import {
  screen, promptInput, promptCursor, chatForm, modelSelect,
  agentModeToggle, agentVal, maxRoundsInput,
  showToast, hideBoot, showBoot,
  createMessageNode, updateBubble, updateThinking, appendNode, renderMessages,
  setBusy, setStatus,
} from "./modules/ui.js";
import { processStream } from "./modules/stream.js";

const CHAT_TIMEOUT_MS = 180000;

let messages = [];
let selectedModel = "";
let agentEnabled = true;
let isProcessing = false;
let abortController = null;
const sessionId = getOrCreateSessionId();

async function fetchStatus() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    const data = await res.json();
    selectedModel = setStatus(
      { ok: res.ok && data.ok, model: data.model, error: data.error, availableModels: data.availableModels },
      selectedModel
    );
  } catch {
    setStatus({ ok: false, error: "local server down. check ollama." }, selectedModel);
  }
}

async function sendMessage(content) {
  if (isProcessing) return;
  const modelToUse = selectedModel || modelSelect.value;
  if (!modelToUse) {
    showToast("select a model first");
    return;
  }

  isProcessing = true;
  hideBoot();

  const userEntry = { role: "user", content, time: Date.now() };
  messages.push(userEntry);
  saveMessages(messages);
  appendNode(createMessageNode(userEntry));

  const payloadMessages = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .map(({ role, content: c }) => ({ role, content: c }));

  const assistantEntry = { role: "assistant", content: "", time: Date.now() };
  messages.push(assistantEntry);
  const assistantNode = appendNode(createMessageNode(assistantEntry));
  const out = assistantNode._bubble;

  setBusy(true);

  let fullContent = "";
  let fullThinking = "";
  let toolUsed = false;
  let lastToolEntry = null;
  let lastToolNode = null;

  abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), CHAT_TIMEOUT_MS);

  try {
    const response = await fetch("/api/chat-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortController.signal,
      body: JSON.stringify({
        model: modelToUse,
        agentMode: agentEnabled,
        maxRounds: parseInt(maxRoundsInput?.value, 10) || 8,
        messages: payloadMessages,
      }),
    });

    if (!response.ok || !response.body) {
      let errorMessage = "connection failed.";
      try { const d = await response.json(); errorMessage = d.error || errorMessage; } catch {}
      throw new Error(errorMessage);
    }

    await processStream(response, {
      onToken(token) {
        fullContent += token;
        assistantEntry.content = fullContent;
        updateBubble(out, fullContent);
      },
      onThinking(chunk) {
        fullThinking += chunk;
        updateThinking(assistantNode, fullThinking);
      },
      onToolCall(event) {
        toolUsed = true;
        lastToolEntry = { role: "tool_call", name: `${event.name} ${JSON.stringify(event.arguments)}`, time: Date.now() };
        messages.splice(messages.length - 1, 0, lastToolEntry);
        lastToolNode = createMessageNode(lastToolEntry);
        screen.insertBefore(lastToolNode, assistantNode);
        screen.scrollTop = screen.scrollHeight;
      },
      onToolResult(event) {
        if (lastToolNode) {
          lastToolNode._state.className = `tool-state ${event.success ? "success" : "error"}`;
          lastToolNode._state.textContent = event.success ? "ok" : "error";
          lastToolNode._out.textContent = event.content;
          lastToolNode._out.style.display = "";
        }
        if (lastToolEntry) {
          lastToolEntry.role = "tool_result";
          lastToolEntry.success = event.success;
          lastToolEntry.content = event.content;
        }
      },
    });

    if (!fullContent.trim() && !toolUsed && !fullThinking.trim()) {
      assistantEntry.content = "-bash: no response from model (possible interference)";
      out.className = "line-err";
      out.textContent = assistantEntry.content;
    } else if (!fullContent.trim() && toolUsed) {
      assistantNode.remove();
      const idx = messages.indexOf(assistantEntry);
      if (idx !== -1) messages.splice(idx, 1);
    } else if (!fullContent.trim() && fullThinking.trim()) {
      assistantEntry.content = "(reasoning only — expand chain of thought above)";
      updateBubble(out, `_${assistantEntry.content}_`);
    }

    saveMessages(messages);
    syncSession(sessionId, messages);
  } catch (error) {
    const idx = messages.indexOf(assistantEntry);
    if (idx !== -1) messages.splice(idx, 1);
    assistantNode.remove();

    const msg = error.name === "AbortError"
      ? "^C  interrupted (timeout). retry or shorten the message."
      : error.message;
    const failEntry = { role: "assistant", content: `-bash: ${msg}`, time: Date.now() };
    messages.push(failEntry);
    saveMessages(messages);
    const errNode = createMessageNode(failEntry);
    errNode.querySelector(".out").className = "line-err";
    appendNode(errNode);
  } finally {
    clearTimeout(timeoutId);
    setBusy(false);
    isProcessing = false;
    abortController = null;
    promptInput.focus();
  }
}

// ── Textarea auto-grow ──
function autoGrow() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
  if (promptCursor) promptCursor.classList.toggle("hidden", promptInput.value.length > 0);
}

async function init() {
  const stored = loadMessages();
  const serverMessages = await restoreSession(sessionId);
  messages = serverMessages ?? stored;
  renderMessages(messages);

  await fetchStatus();
  setInterval(fetchStatus, 20000);
  promptInput.focus();
}

// ── Event wiring ──
promptInput.addEventListener("input", autoGrow);

promptInput.addEventListener("keydown", (e) => {
  // Enter sends; Shift+Enter inserts a newline.
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const content = promptInput.value.trim();
    if (!content) return;
    promptInput.value = "";
    autoGrow();
    sendMessage(content);
  }
  if (e.key === "Escape" && isProcessing && abortController) {
    abortController.abort();
    showToast("^C interrupted");
  }
});

chatForm.addEventListener("submit", (e) => e.preventDefault());

agentModeToggle.addEventListener("click", () => {
  agentEnabled = !agentEnabled;
  agentModeToggle.setAttribute("aria-pressed", String(agentEnabled));
  agentVal.textContent = agentEnabled ? "on" : "off";
});

modelSelect.addEventListener("change", () => {
  selectedModel = modelSelect.value;
});

// Boot hint buttons
document.addEventListener("click", (e) => {
  const hint = e.target.closest(".hint");
  if (!hint) return;
  const text = hint.dataset.example;
  if (text) sendMessage(text);
});

// Clicking anywhere on the terminal focuses the prompt (unless selecting text).
document.querySelector(".terminal").addEventListener("mouseup", () => {
  if (!window.getSelection().toString()) promptInput.focus();
});

// Ctrl+L clears the screen (like a real shell).
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    clearSession(sessionId);
    messages = [];
    saveMessages(messages);
    renderMessages(messages);
    showToast("cleared");
  }
});

init();
