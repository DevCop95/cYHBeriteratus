import { getOrCreateSessionId, loadMessages, saveMessages, restoreSession, syncSession, clearSession } from "./modules/session.js";
import { chatLog, chatForm, promptInput, clearButton, sendButton, modelSelect, agentModeToggle, maxRoundsInput, toolTemplate, formatTime, createMessageNode, renderMessages, setBusy, setStatus } from "./modules/ui.js";
import { processStream } from "./modules/stream.js";

const CHAT_TIMEOUT_MS = 180000;

let messages = [];
let selectedModel = "";
let sessionId = getOrCreateSessionId();

function appendMessage(entry) {
  if (
    chatLog.children.length === 1 &&
    chatLog.firstElementChild?.textContent.includes("[ACCESO NO AUTORIZADO]")
  ) {
    chatLog.innerHTML = "";
  }
  const node = createMessageNode(entry);
  chatLog.appendChild(node);
  chatLog.scrollTop = chatLog.scrollHeight;
  return node;
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
    setStatus({ ok: false, error: "Servidor local inactivo. Verifica Ollama." }, selectedModel);
  }
}

async function sendMessage(content) {
  const userEntry = { role: "user", content, time: formatTime() };
  messages.push(userEntry);
  saveMessages(messages);
  appendMessage(userEntry);
  setBusy(true);

  const modelToUse = selectedModel || modelSelect.value;
  if (!modelToUse) {
    const fail = { role: "assistant", content: "☢ FALLO: Selecciona un modelo primero.", time: formatTime() };
    messages.push(fail);
    saveMessages(messages);
    appendMessage(fail);
    setBusy(false);
    return;
  }

  const assistantEntry = { role: "assistant", content: "[CONECTANDO] Estableciendo enlace oscuro...", time: formatTime() };
  messages.push(assistantEntry);
  const assistantNode = appendMessage(assistantEntry);
  const assistantContent = assistantNode.querySelector(".message__content");
  let fullContent = "";
  let toolUsed = false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

  try {
    let response;
    try {
      response = await fetch("/api/chat-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelToUse,
          agentMode: agentModeToggle?.checked ?? false,
          maxRounds: parseInt(maxRoundsInput?.value, 10) || 8,
          messages: messages
            .filter(m =>
              (m.role === "user" || m.role === "assistant") &&
              !m.content?.startsWith("[CONECTANDO]") &&
              !m.content?.startsWith("[ERROR]")
            )
            .map(({ role, content: c }) => ({ role, content: c })),
        }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok || !response.body) {
      let errorMessage = "FALLO EN LA CONEXION OSCURA.";
      try { const d = await response.json(); errorMessage = d.error || errorMessage; } catch {}
      throw new Error(errorMessage);
    }

    await processStream(response, {
      onToken(token) {
        if (fullContent.length === 0 && assistantEntry.content === "[CONECTANDO] Estableciendo enlace oscuro...") {
          assistantEntry.content = "";
          assistantContent.textContent = "";
        }
        fullContent += token;
        assistantEntry.content = fullContent;
        assistantContent.textContent = fullContent;
        chatLog.scrollTop = chatLog.scrollHeight;
      },
      onToolCall(event) {
        toolUsed = true;
        if (assistantEntry.content === "[CONECTANDO] Estableciendo enlace oscuro...") {
          assistantEntry.content = "";
          assistantContent.textContent = "";
        }
        const fragment = toolTemplate.content.cloneNode(true);
        const article = fragment.querySelector(".message");
        fragment.querySelector(".message__time").textContent = formatTime();
        fragment.querySelector(".tool-name").textContent = `[Tool] ${event.name}(${JSON.stringify(event.arguments)})`;
        chatLog.insertBefore(article, assistantNode);
        chatLog.scrollTop = chatLog.scrollHeight;
      },
      onToolResult(event) {
        const toolNodes = chatLog.querySelectorAll(".message--tool");
        if (toolNodes.length > 0) {
          const last = toolNodes[toolNodes.length - 1];
          const status = last.querySelector(".tool-status");
          const result = last.querySelector(".tool-result");
          status.textContent = event.success ? "Completado" : "Error";
          status.className = `tool-status ${event.success ? "success" : "error"}`;
          result.textContent = event.content;
          result.classList.remove("hidden");
          chatLog.scrollTop = chatLog.scrollHeight;
        }
      },
    });

    if (!fullContent.trim() && !toolUsed) {
      assistantEntry.content = "[ERROR] El modelo no respondio. Posible interferencia.";
      assistantContent.textContent = assistantEntry.content;
    } else if (!fullContent.trim() && toolUsed && assistantEntry.content === "[CONECTANDO] Estableciendo enlace oscuro...") {
      assistantEntry.content = "";
      assistantContent.textContent = "";
    }

    saveMessages(messages);
    syncSession(sessionId, messages);

  } catch (error) {
    if (
      messages[messages.length - 1]?.role === "assistant" &&
      messages[messages.length - 1].content === "[CONECTANDO] Estableciendo enlace oscuro..."
    ) {
      messages.pop();
    }
    const msg = error.name === "AbortError"
      ? "Se corto el enlace. Demasiado tiempo de espera. Reintenta o reduce el mensaje."
      : error.message;
    const failEntry = { role: "assistant", content: `☢ FALLO: ${msg}`, time: formatTime() };
    messages.push(failEntry);
    saveMessages(messages);
    appendMessage(failEntry);
  } finally {
    setBusy(false);
  }
}

async function init() {
  const stored = loadMessages();
  const serverMessages = await restoreSession(sessionId);
  messages = serverMessages ?? stored;
  renderMessages(messages);
  await fetchStatus();
  setInterval(fetchStatus, 20000);
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = promptInput.value.trim();
  if (!content) return;
  promptInput.value = "";
  await sendMessage(content);
});

clearButton.addEventListener("click", () => {
  clearSession(sessionId);
  messages = [];
  saveMessages(messages);
  renderMessages(messages);
});

modelSelect.addEventListener("change", () => {
  selectedModel = modelSelect.value;
});

init();
