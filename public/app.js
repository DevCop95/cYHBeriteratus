import { getOrCreateSessionId, loadMessages, saveMessages, restoreSession, syncSession, clearSession } from "./modules/session.js";
import {
  chat, messagesEl, promptInput, sendBtn, chatForm, modelSelect,
  agentToggle, agentVal, roundsInput, newChatBtn,
  showToast, hideWelcome, showWelcome,
  createMessageNode, updateBubble, updateThinking, appendNode, renderMessages,
  setBusy, updateSendState, setStatus, setToolOutput, setStreaming, initScrollBottom,
} from "./modules/ui.js";
import { processStream } from "./modules/stream.js";

// Abort only after this long with NO streaming activity (idle), not a hard total cap —
// long multi-round agent responses keep going as long as they make progress.
const IDLE_TIMEOUT_MS = 90000;

let messages = [];
let selectedModel = "";
let agentEnabled = true;
let isProcessing = false;
let abortController = null;
let abortReason = null; // "timeout" | "manual" | null
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
  setStreaming(contentEl, true);

  let fullContent = "";
  let fullThinking = "";
  let toolUsed = false;
  let lastToolEntry = null;
  let lastToolNode = null;

  abortController = new AbortController();
  abortReason = null;
  let idleTimer = null;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { abortReason = "timeout"; abortController?.abort(); }, IDLE_TIMEOUT_MS);
  };
  resetIdle();

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
        resetIdle();
        fullContent += token;
        assistantEntry.content = fullContent;
        updateBubble(contentEl, fullContent);
      },
      onThinking(chunk) {
        resetIdle();
        fullThinking += chunk;
        updateThinking(assistantNode, fullThinking);
      },
      onToolCall(event) {
        resetIdle();
        toolUsed = true;
        lastToolEntry = { role: "tool_call", name: `${event.name} ${JSON.stringify(event.arguments)}`, time: Date.now() };
        messages.splice(messages.length - 1, 0, lastToolEntry);
        lastToolNode = createMessageNode(lastToolEntry);
        messagesEl.insertBefore(lastToolNode, assistantNode);
        chat.scrollTop = chat.scrollHeight;
      },
      onToolResult(event) {
        resetIdle();
        if (lastToolNode) {
          lastToolNode._state.className = `tool__state ${event.success ? "success" : "error"}`;
          lastToolNode._state.textContent = event.success ? "done" : "error";
          setToolOutput(lastToolNode._out, event.content);
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
    const isAbort = error.name === "AbortError";

    if (fullContent.trim()) {
      // Keep whatever was already streamed — don't discard a partial answer.
      const note = isAbort && abortReason === "manual"
        ? "\n\n*(stopped)*"
        : isAbort
          ? "\n\n*(interrupted — the model went idle; the reply above was cut off)*"
          : `\n\n*(interrupted — ${error.message})*`;
      assistantEntry.content = fullContent + note;
      updateBubble(contentEl, assistantEntry.content);
    } else {
      // Nothing was streamed — drop the empty placeholder and show an error line.
      const idx = messages.indexOf(assistantEntry);
      if (idx !== -1) messages.splice(idx, 1);
      assistantNode.remove();

      const msg = isAbort
        ? (abortReason === "timeout"
            ? "The model went idle for too long and was stopped — try again or pick a faster model."
            : "Stopped.")
        : error.message;
      const failEntry = { role: "assistant", content: `⚠ ${msg}`, time: Date.now() };
      messages.push(failEntry);
      const node = createMessageNode(failEntry);
      node._content.innerHTML = `<span class="err">${node._content.textContent}</span>`;
      appendNode(node);
    }

    saveMessages(messages);
    syncSession(sessionId, messages);
  } finally {
    clearTimeout(idleTimer);
    setStreaming(contentEl, false);
    setBusy(false);
    isProcessing = false;
    abortController = null;
    promptInput.focus();
  }
}

function regenerate() {
  if (isProcessing) return;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx === -1) return;
  const content = messages[lastUserIdx].content;
  messages.splice(lastUserIdx); // drop the user msg + everything after (responses, tools)
  saveMessages(messages);
  renderMessages(messages);
  sendMessage(content);
}

function editMessage(entry) {
  if (isProcessing || !entry) return;
  const idx = messages.indexOf(entry);
  if (idx !== -1) {
    messages.splice(idx); // remove this message and everything after it
    saveMessages(messages);
    renderMessages(messages);
    if (messages.length === 0) showWelcome();
  }
  promptInput.value = entry.content || "";
  autoGrow();
  updateSendState();
  promptInput.focus();
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
  initScrollBottom();
  promptInput.focus();
}

// ── Events ──
chatForm.addEventListener("submit", (e) => { e.preventDefault(); submit(); });

// Composer button doubles as Stop while generating.
sendBtn.addEventListener("click", (e) => {
  if (isProcessing && abortController) {
    e.preventDefault();
    abortReason = "manual";
    abortController.abort();
  }
});

// Per-message actions (dispatched from the hover action bar).
document.addEventListener("wg:regenerate", () => regenerate());
document.addEventListener("wg:edit", (e) => editMessage(e.detail));

promptInput.addEventListener("input", () => { autoGrow(); updateSendState(); });

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
  if (e.key === "Escape" && isProcessing && abortController) {
    abortReason = "manual";
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
