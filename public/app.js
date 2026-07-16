import { getOrCreateSessionId, loadMessages, saveMessages, restoreSession, syncSession, clearSession } from "./modules/session.js";
import {
  chat, messagesEl, promptInput, sendBtn, chatForm, modelSelect,
  agentToggle, agentVal, roundsInput, newChatBtn,
  showToast, hideWelcome,
  createMessageNode, updateBubble, updateThinking, appendNode, renderMessages,
  setBusy, updateSendState, setStatus,
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
    setStatus({ ok: false, error: "Local server down. Check Ollama." }, selectedModel);
  }
}

async function sendMessage(content) {
  if (isProcessing) return;
  const modelToUse = selectedModel || modelSelect.value;
  if (!modelToUse) {
    showToast("Select a model first");
    return;
  }

  isProcessing = true;
  hideWelcome();

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
  const contentEl = assistantNode._content;

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
        maxRounds: parseInt(roundsInput?.value, 10) || 8,
        messages: payloadMessages,
      }),
    });

    if (!response.ok || !response.body) {
      let errorMessage = "Connection failed.";
      try { const d = await response.json(); errorMessage = d.error || errorMessage; } catch {}
      throw new Error(errorMessage);
    }

    await processStream(response, {
      onToken(token) {
        fullContent += token;
        assistantEntry.content = fullContent;
        updateBubble(contentEl, fullContent);
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
        messagesEl.insertBefore(lastToolNode, assistantNode);
        chat.scrollTop = chat.scrollHeight;
      },
      onToolResult(event) {
        if (lastToolNode) {
          lastToolNode._state.className = `tool__state ${event.success ? "success" : "error"}`;
          lastToolNode._state.textContent = event.success ? "done" : "error";
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
      assistantEntry.content = "No response from the model. Try again or pick another model.";
      contentEl.innerHTML = `<span class="err">${assistantEntry.content}</span>`;
    } else if (!fullContent.trim() && toolUsed) {
      assistantNode.remove();
      const idx = messages.indexOf(assistantEntry);
      if (idx !== -1) messages.splice(idx, 1);
    } else if (!fullContent.trim() && fullThinking.trim()) {
      assistantEntry.content = "*(reasoning only — expand “Show reasoning” above)*";
      updateBubble(contentEl, assistantEntry.content);
    }

    saveMessages(messages);
    syncSession(sessionId, messages);
  } catch (error) {
    const idx = messages.indexOf(assistantEntry);
    if (idx !== -1) messages.splice(idx, 1);
    assistantNode.remove();

    const msg = error.name === "AbortError"
      ? "Stopped. Timed out — retry or shorten the message."
      : error.message;
    const failEntry = { role: "assistant", content: `⚠ ${msg}`, time: Date.now() };
    messages.push(failEntry);
    saveMessages(messages);
    const node = createMessageNode(failEntry);
    node._content.innerHTML = `<span class="err">${node._content.textContent}</span>`;
    appendNode(node);
  } finally {
    clearTimeout(timeoutId);
    setBusy(false);
    isProcessing = false;
    abortController = null;
    promptInput.focus();
  }
}

function submit() {
  const content = promptInput.value.trim();
  if (!content || isProcessing) return;
  promptInput.value = "";
  autoGrow();
  updateSendState();
  sendMessage(content);
}

function autoGrow() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 200)}px`;
}

function newChat() {
  if (isProcessing && abortController) abortController.abort();
  clearSession(sessionId);
  messages = [];
  saveMessages(messages);
  renderMessages(messages);
  promptInput.focus();
}

async function init() {
  const stored = loadMessages();
  const serverMessages = await restoreSession(sessionId);
  messages = serverMessages ?? stored;
  renderMessages(messages);
  await fetchStatus();
  setInterval(fetchStatus, 20000);
  updateSendState();
  promptInput.focus();
}

// ── Events ──
chatForm.addEventListener("submit", (e) => { e.preventDefault(); submit(); });

promptInput.addEventListener("input", () => { autoGrow(); updateSendState(); });

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
  if (e.key === "Escape" && isProcessing && abortController) {
    abortController.abort();
    showToast("Stopped");
  }
});

agentToggle.addEventListener("click", () => {
  agentEnabled = !agentEnabled;
  agentToggle.setAttribute("aria-pressed", String(agentEnabled));
  agentVal.textContent = agentEnabled ? "on" : "off";
});

modelSelect.addEventListener("change", () => { selectedModel = modelSelect.value; });

newChatBtn.addEventListener("click", newChat);

document.getElementById("sidebarToggle")?.addEventListener("click", () => {
  document.querySelector(".app").classList.toggle("sidebar-collapsed");
});

// Welcome suggestion cards
document.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card?.dataset.example) sendMessage(card.dataset.example);
});

init();
