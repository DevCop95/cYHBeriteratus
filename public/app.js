const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const promptInput = document.getElementById("promptInput");
const clearButton = document.getElementById("clearButton");
const sendButton = document.getElementById("sendButton");
const messageCount = document.getElementById("messageCount");
const sessionState = document.getElementById("sessionState");
const modelName = document.getElementById("modelName");
const modelPort = document.getElementById("modelPort");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const messageTemplate = document.getElementById("messageTemplate");
const chatTimeoutMs = 50000;
const streamIdleTimeoutMs = 45000;

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
  localStorage.setItem(storageKey, JSON.stringify(messages));
}

function updateCounters() {
  messageCount.textContent = String(messages.length);
}

function formatTime(value = new Date()) {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function createMessageNode(entry) {
  const fragment = messageTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".message");
  const role = fragment.querySelector(".message__role");
  const time = fragment.querySelector(".message__time");
  const content = fragment.querySelector(".message__content");

  article.classList.add(entry.role === "user" ? "message--user" : "message--assistant");
  role.textContent = entry.role === "user" ? "Operador" : "Ollama";
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
      '<div class="message__chrome"><span class="message__role">Sistema</span><span class="message__time">' +
      formatTime() +
      '</span></div><p class="message__content">Consola lista. Escribe tu primer mensaje para iniciar la sesion con el modelo local.</p>';
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
  sessionState.textContent = isBusy ? "Transmitiendo" : "Lista";
  sendButton.textContent = isBusy ? "Enviando..." : "Enviar a Ollama";
}

function setStatus({ ok, model, port, error, modelLoaded }) {
  modelName.textContent = model || modelName.textContent;
  modelPort.textContent = port || modelPort.textContent;
  statusBadge.classList.remove("online", "offline");

  if (ok) {
    statusBadge.classList.add("online");
    statusText.textContent = modelLoaded ? "Ollama online" : "Ollama activo, modelo no detectado";
  } else {
    statusBadge.classList.add("offline");
    statusText.textContent = error ? `Error: ${error}` : "Ollama sin conexion";
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
    });
  } catch (error) {
    setStatus({
      ok: false,
      error: "No responde el servidor local",
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

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), chatTimeoutMs);
    const assistantEntry = {
      role: "assistant",
      content: "Conectando con Ollama...",
      time: formatTime(),
    };
    messages.push(assistantEntry);
    const assistantNode = appendMessage(assistantEntry);
    const assistantContent = assistantNode.querySelector(".message__content");
    let response;

    try {
      response = await fetch("/api/chat-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages: messages.map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok || !response.body) {
      let errorMessage = "No se pudo iniciar el stream.";
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

    const readWithTimeout = async () => {
      let timeoutId;
      try {
        return await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("El stream de Ollama no envio tokens a tiempo."));
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
          if (fullContent.length === 0) {
            assistantEntry.content = "";
          }
          fullContent += event.content;
          assistantEntry.content = fullContent;
          assistantContent.textContent = fullContent;
          chatLog.scrollTop = chatLog.scrollHeight;
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

    if (!fullContent.trim()) {
      assistantEntry.content = "El modelo no devolvio texto.";
      assistantContent.textContent = assistantEntry.content;
    }

    saveMessages();
    fetchStatus();
  } catch (error) {
    if (
      messages[messages.length - 1]?.role === "assistant" &&
      messages[messages.length - 1].content === "Conectando con Ollama..."
    ) {
      messages.pop();
    }

    const message =
      error.name === "AbortError"
        ? "La solicitud tardo demasiado. Revisa si Ollama sigue generando o intenta un prompt mas corto."
        : error.message;
    const failureEntry = {
      role: "assistant",
      content: `Fallo de conexion: ${message}`,
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

renderMessages();
fetchStatus();
setInterval(fetchStatus, 20000);
