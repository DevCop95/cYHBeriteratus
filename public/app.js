const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const promptInput = document.getElementById("promptInput");
const clearButton = document.getElementById("clearButton");
const sendButton = document.getElementById("sendButton");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const messageTemplate = document.getElementById("messageTemplate");
const toolTemplate = document.getElementById("toolTemplate");
const modelSelect = document.getElementById("modelSelect");
const agentModeToggle = document.getElementById("agentModeToggle");
const chatTimeoutMs = 180000;
const streamIdleTimeoutMs = 120000;

let selectedModel = "";

const storageKey = "ollama-cyber-console-history";
let messages = loadMessages();

function loadMessages() {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages() {
  try { localStorage.setItem(storageKey, JSON.stringify(messages)); } catch {}
}

function updateCounters() {
}

function formatTime(value = new Date()) {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function createMessageNode(entry) {
  if (entry.role === "tool_call" || entry.role === "tool_result") {
    // Handled dynamically during streaming, but if loaded from history:
    const fragment = toolTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".message");
    const time = fragment.querySelector(".message__time");
    const toolName = fragment.querySelector(".tool-name");
    const toolStatus = fragment.querySelector(".tool-status");
    const toolResult = fragment.querySelector(".tool-result");

    time.textContent = entry.time || formatTime();
    toolName.textContent = entry.name;
    toolStatus.textContent = entry.role === "tool_call" ? "Ejecutando..." : (entry.success ? "Completado" : "Error");
    toolStatus.className = `tool-status ${entry.role === "tool_call" ? "spinner" : (entry.success ? "success" : "error")}`;
    
    if (entry.content) {
      toolResult.textContent = entry.content;
      toolResult.classList.remove("hidden");
    }
    article.dataset.role = entry.role;
    return article;
  }

  const fragment = messageTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".message");
  const role = fragment.querySelector(".message__role");
  const time = fragment.querySelector(".message__time");
  const content = fragment.querySelector(".message__content");

  article.classList.add(entry.role === "user" ? "message--user" : "message--assistant");
  role.textContent = entry.role === "user" ? "OPERADOR" : "WRONG GPT";
  time.textContent = entry.time || formatTime();
  content.textContent = entry.content;
  article.dataset.role = entry.role;

  return article;
}

function renderMessages() {
  chatLog.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("article");
    empty.className = "message message--assistant";
    empty.innerHTML =
      '<div class="message__chrome"><span class="message__role">&#x2620; SISTEMA</span><span class="message__time">' +
      formatTime() +
      '</span></div><p class="message__content">[ACCESO NO AUTORIZADO] Terminal lista. Escribe tu primer mensaje para iniciar la sesion con el modelo local.</p>';
    chatLog.appendChild(empty);
  } else {
    messages.forEach((entry) => {
      chatLog.appendChild(createMessageNode(entry));
    });
  }

  updateCounters();
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendMessage(entry) {
  const node = createMessageNode(entry);
  if (!messages.length) {
    renderMessages();
    return chatLog.lastElementChild;
  }

  const systemMessage = chatLog.querySelector('.message[data-role="assistant"]');
  if (messages.length === 1 && systemMessage && systemMessage.textContent.includes("Consola lista.")) {
    renderMessages();
    return chatLog.lastElementChild;
  }

  if (
    chatLog.children.length === 1 &&
    chatLog.firstElementChild?.textContent.includes("Consola lista.")
  ) {
    chatLog.innerHTML = "";
  }

  chatLog.appendChild(node);
  updateCounters();
  chatLog.scrollTop = chatLog.scrollHeight;
  return node;
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  promptInput.disabled = isBusy;
  sendButton.textContent = isBusy ? "ENVIANDO..." : "\u2622 ENVIAR \u2622";
}

const githubSvg = '<a href="https://github.com/DevCop95/cYHBeriteratus" target="_blank" style="color:inherit;text-decoration:none"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:4px"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>';

function setStatus({ ok, model, port, error, modelLoaded, availableModels }) {
  statusBadge.classList.remove("online", "offline");

  if (ok) {
    statusBadge.classList.add("online");
    statusText.innerHTML = githubSvg + 'DEV101';

    const allModels = availableModels || [];

    if (allModels.length > 0) {
      const activeModel = selectedModel || model;
      modelSelect.innerHTML = allModels.map(name =>
        `<option value="${name}" ${name === activeModel ? "selected" : ""}>${name}</option>`
      ).join("");
      modelSelect.disabled = false;

      if (!selectedModel && model) {
        selectedModel = model;
      }
    } else {
      modelSelect.innerHTML = '<option value="">No hay modelos instalados</option>';
      modelSelect.disabled = true;
    }
  } else {
    statusBadge.classList.add("offline");
    statusText.textContent = error ? `FALLO: ${error}` : "ENLACE CORTADO";
    modelSelect.innerHTML = '<option value="">Sin conexion</option>';
    modelSelect.disabled = true;
  }
}

async function fetchStatus() {
  try {
    const response = await fetch("/api/status", {
      cache: "no-store",
    });
    const data = await response.json();
    setStatus({
      ok: response.ok && data.ok,
      model: data.model,
      port: data.port,
      error: data.error,
      modelLoaded: data.modelLoaded,
      availableModels: data.availableModels,
    });
  } catch (error) {
    setStatus({
      ok: false,
      error: "Servidor local inactivo. Verifica Ollama.",
    });
  }
}

async function sendMessage(content) {
  const userEntry = {
    role: "user",
    content,
    time: formatTime(),
  };

  messages.push(userEntry);
  saveMessages();
  appendMessage(userEntry);
  setBusy(true);

  const modelToUse = selectedModel || modelSelect.value;
  if (!modelToUse) {
    const failureEntry = {
      role: "assistant",
      content: "&#x2620; FALLO: Selecciona un modelo primero.",
      time: formatTime(),
    };
    messages.push(failureEntry);
    saveMessages();
    appendMessage(failureEntry);
    setBusy(false);
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), chatTimeoutMs);
    const assistantEntry = {
      role: "assistant",
      content: "[CONECTANDO] Estableciendo enlace oscuro...",
      time: formatTime(),
    };
    messages.push(assistantEntry);
    const assistantNode = appendMessage(assistantEntry);
    const assistantContent = assistantNode.querySelector(".message__content");
    let response;

    try {
      response = await fetch("/api/chat-agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelToUse,
          agentMode: agentModeToggle ? agentModeToggle.checked : false,
          messages: messages.filter(m =>
            (m.role === "user" || m.role === "assistant") &&
            !m.content?.startsWith("[CONECTANDO]") &&
            !m.content?.startsWith("[ERROR]")
          ).map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok || !response.body) {
      let errorMessage = "FALLO EN LA CONEXION OSCURA.";
      try {
        const data = await response.json();
        errorMessage = data.error || errorMessage;
      } catch {
        // Keep default fallback.
      }
      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let streamDone = false;
    let toolUsed = false;

    const readWithTimeout = async () => {
      let timeoutId;
      try {
        return await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("Timeout del enlace oscuro. Se perdio la trasmision."));
            }, streamIdleTimeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
    };

    while (!streamDone) {
      const { value, done } = await readWithTimeout();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        const event = JSON.parse(line);

        if (event.type === "token" && event.content) {
          if (fullContent.length === 0 && assistantEntry.content === "[CONECTANDO] Estableciendo enlace oscuro...") {
            assistantEntry.content = "";
            assistantContent.textContent = "";
          }
          fullContent += event.content;
          assistantEntry.content = fullContent;
          assistantContent.textContent = fullContent;
          chatLog.scrollTop = chatLog.scrollHeight;
        }

        if (event.type === "tool_call") {
          toolUsed = true;
          if (fullContent.length === 0 && assistantEntry.content === "[CONECTANDO] Estableciendo enlace oscuro...") {
            assistantEntry.content = "";
            assistantContent.textContent = "";
          }

          const fragment = toolTemplate.content.cloneNode(true);
          const article = fragment.querySelector(".message");
          const time = fragment.querySelector(".message__time");
          const toolName = fragment.querySelector(".tool-name");
          const toolResultNode = fragment.querySelector(".tool-result");
          
          time.textContent = formatTime();
          toolName.textContent = `[Tool] ${event.name}(${JSON.stringify(event.arguments)})`;
          
          // Insert before the currently building assistant message
          chatLog.insertBefore(article, assistantNode);
          chatLog.scrollTop = chatLog.scrollHeight;
          
          // Keep a reference to update it later
          event._articleNode = article;
        }

        if (event.type === "tool_result") {
          // Update the last tool_call node (simplistic tracking)
          const toolNodes = chatLog.querySelectorAll(".message--tool");
          if (toolNodes.length > 0) {
            const lastToolNode = toolNodes[toolNodes.length - 1];
            const status = lastToolNode.querySelector(".tool-status");
            const result = lastToolNode.querySelector(".tool-result");
            
            status.textContent = event.success ? "Completado" : "Error";
            status.className = `tool-status ${event.success ? "success" : "error"}`;
            
            result.textContent = event.content;
            result.classList.remove("hidden");
            chatLog.scrollTop = chatLog.scrollHeight;
          }
        }

        if (event.type === "error") {
          throw new Error(event.error || "Error durante el stream.");
        }

        if (event.type === "done") {
          streamDone = true;
          break;
        }
      }
    }

    if (!fullContent.trim() && !toolUsed) {
      assistantEntry.content = "[ERROR] El modelo no respondio. Posible interferencia.";
      assistantContent.textContent = assistantEntry.content;
    } else if (!fullContent.trim() && toolUsed) {
      // Clear placeholder if tools were used but no final text was given
      if (assistantEntry.content === "[CONECTANDO] Estableciendo enlace oscuro...") {
        assistantEntry.content = "";
        assistantContent.textContent = "";
      }
    }

    saveMessages();
  } catch (error) {
    if (
      messages[messages.length - 1]?.role === "assistant" &&
      messages[messages.length - 1].content === "[CONECTANDO] Estableciendo enlace oscuro..."
    ) {
      messages.pop();
    }

    const message =
      error.name === "AbortError"
        ? "Se corto el enlace. Demasiado tiempo de espera. Reintenta o reduce el mensaje."
        : error.message;
    const failureEntry = {
      role: "assistant",
      content: `&#x2620; FALLO: ${message}`,
      time: formatTime(),
    };
    messages.push(failureEntry);
    saveMessages();
    appendMessage(failureEntry);
  } finally {
    setBusy(false);
    updateCounters();
  }
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = promptInput.value.trim();
  if (!content) {
    return;
  }

  promptInput.value = "";
  await sendMessage(content);
});

clearButton.addEventListener("click", () => {
  messages = [];
  saveMessages();
  renderMessages();
});

modelSelect.addEventListener("change", () => {
  selectedModel = modelSelect.value;
  fetchStatus();
});

renderMessages();
fetchStatus();
setInterval(fetchStatus, 20000);
