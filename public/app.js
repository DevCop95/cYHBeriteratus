import { getOrCreateSessionId, loadMessages, saveMessages, restoreSession, syncSession, clearSession } from "./modules/session.js";
import {
  chatContainer, promptInput, sendButton, clearButton, modelSelect,
  agentModeToggle, maxRoundsInput, welcomeScreen,
  formatTime, showToast, hideWelcome, showWelcome,
  createMessageNode, updateBubble, updateThinking, appendNode, renderMessages,
  setBusy, setStatus, updateStats,
} from "./modules/ui.js";
import { processStream } from "./modules/stream.js";

const CHAT_TIMEOUT_MS = 180000;

let messages = [];
let selectedModel = "";
let isProcessing = false;
let abortController = null;
const sessionId = getOrCreateSessionId();

function countMessages() {
  return messages.filter((m) => m.role === "user" || m.role === "assistant").length;
}

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

  const userEntry = { role: "user", content, time: formatTime() };
  messages.push(userEntry);
  saveMessages(messages);
  appendNode(createMessageNode(userEntry));
  updateStats({ count: countMessages() });

  // Build the request payload before adding the streaming placeholder.
  const payloadMessages = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .map(({ role, content: c }) => ({ role, content: c }));

  const assistantEntry = { role: "assistant", content: "", time: formatTime() };
  messages.push(assistantEntry);
  const assistantNode = appendNode(createMessageNode(assistantEntry));
  const bubble = assistantNode._bubble;

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
        agentMode: agentModeToggle?.checked ?? false,
        maxRounds: parseInt(maxRoundsInput?.value, 10) || 8,
        messages: payloadMessages,
      }),
    });

    if (!response.ok || !response.body) {
      let errorMessage = "DARK LINK CONNECTION FAILED.";
      try { const d = await response.json(); errorMessage = d.error || errorMessage; } catch {}
      throw new Error(errorMessage);
    }

    await processStream(response, {
      onToken(token) {
        fullContent += token;
        assistantEntry.content = fullContent;
        updateBubble(bubble, fullContent);
      },
      onThinking(chunk) {
        fullThinking += chunk;
        updateThinking(assistantNode, fullThinking);
      },
      onToolCall(event) {
        toolUsed = true;
        lastToolEntry = { role: "tool_call", name: `${event.name}(${JSON.stringify(event.arguments)})`, time: formatTime() };
        messages.splice(messages.length - 1, 0, lastToolEntry); // keep before assistant entry
        lastToolNode = createMessageNode(lastToolEntry);
        chatContainer.insertBefore(lastToolNode, assistantNode);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      },
      onToolResult(event) {
        if (lastToolNode) {
          lastToolNode._status.className = `tool-status ${event.success ? "success" : "error"}`;
          lastToolNode._status.textContent = event.success ? "Done" : "Error";
          lastToolNode._result.textContent = event.content;
          lastToolNode._result.style.display = "";
        }
        if (lastToolEntry) {
          lastToolEntry.role = "tool_result";
          lastToolEntry.success = event.success;
          lastToolEntry.content = event.content;
        }
      },
    });

    if (!fullContent.trim() && !toolUsed && !fullThinking.trim()) {
      assistantEntry.content = "[ERROR] The model did not respond. Possible interference.";
      updateBubble(bubble, assistantEntry.content);
    } else if (!fullContent.trim() && toolUsed) {
      // Only tools ran, no final text — drop the empty assistant bubble.
      assistantNode.remove();
      const idx = messages.indexOf(assistantEntry);
      if (idx !== -1) messages.splice(idx, 1);
    } else if (!fullContent.trim() && fullThinking.trim()) {
      // Reasoning only, no final answer — show a hint instead of a blank bubble.
      assistantEntry.content = "_(model produced reasoning only — see CHAIN OF THOUGHT above)_";
      updateBubble(bubble, assistantEntry.content);
    }

    saveMessages(messages);
    syncSession(sessionId, messages);
  } catch (error) {
    const idx = messages.indexOf(assistantEntry);
    if (idx !== -1) messages.splice(idx, 1);
    assistantNode.remove();

    const msg = error.name === "AbortError"
      ? "Link cut. Timed out. Retry or shorten the message."
      : error.message;
    const failEntry = { role: "assistant", content: `☢ FAILURE: ${msg}`, time: formatTime() };
    messages.push(failEntry);
    saveMessages(messages);
    appendNode(createMessageNode(failEntry));
  } finally {
    clearTimeout(timeoutId);
    setBusy(false);
    isProcessing = false;
    abortController = null;
    updateStats({ count: countMessages() });
    promptInput.focus();
  }
}

// ── Textarea auto-grow ──
function autoGrow() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
}

// ── Live clock ──
function updateClock() {
  const now = new Date();
  const formatted = now.toLocaleString("en-US", {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const live = document.getElementById("liveClock");
  const welcome = document.getElementById("welcomeClock");
  if (live) live.textContent = formatted;
  if (welcome) welcome.textContent = formatted;
}

async function init() {
  updateStats({ sessionId });
  const stored = loadMessages();
  const serverMessages = await restoreSession(sessionId);
  messages = serverMessages ?? stored;
  renderMessages(messages);
  updateStats({ count: countMessages() });

  await fetchStatus();
  setInterval(fetchStatus, 20000);

  updateClock();
  setInterval(updateClock, 1000);
  promptInput.focus();
}

// ── Event wiring ──
promptInput.addEventListener("input", autoGrow);

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const content = promptInput.value.trim();
    if (!content) return;
    promptInput.value = "";
    autoGrow();
    sendMessage(content);
  }
  if (e.key === "Escape" && isProcessing && abortController) {
    abortController.abort();
    showToast("Request cancelled");
  }
});

sendButton.addEventListener("click", () => {
  const content = promptInput.value.trim();
  if (!content) return;
  promptInput.value = "";
  autoGrow();
  sendMessage(content);
});

clearButton.addEventListener("click", () => {
  clearSession(sessionId);
  messages = [];
  saveMessages(messages);
  renderMessages(messages);
  updateStats({ count: 0 });
  showToast("Session purged");
});

modelSelect.addEventListener("change", () => {
  selectedModel = modelSelect.value;
  updateStats({ model: selectedModel });
});

welcomeScreen?.addEventListener("click", (e) => {
  const btn = e.target.closest(".example-btn");
  if (!btn) return;
  const text = btn.dataset.example;
  if (text) sendMessage(text);
});

init();
