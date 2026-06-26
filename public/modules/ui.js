export const chatLog = document.getElementById("chatLog");
export const chatForm = document.getElementById("chatForm");
export const promptInput = document.getElementById("promptInput");
export const clearButton = document.getElementById("clearButton");
export const sendButton = document.getElementById("sendButton");
export const statusBadge = document.getElementById("statusBadge");
export const statusText = document.getElementById("statusText");
export const messageTemplate = document.getElementById("messageTemplate");
export const toolTemplate = document.getElementById("toolTemplate");
export const modelSelect = document.getElementById("modelSelect");
export const agentModeToggle = document.getElementById("agentModeToggle");
export const maxRoundsInput = document.getElementById("maxRoundsInput");

const githubSvg = '<a href="https://github.com/DevCop95/cYHBeriteratus" target="_blank" style="color:inherit;text-decoration:none"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:4px"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>';

export function formatTime(value = new Date()) {
  return new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" }).format(value);
}

export function createMessageNode(entry) {
  if (entry.role === "tool_call" || entry.role === "tool_result") {
    const fragment = toolTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".message");
    const toolName = fragment.querySelector(".tool-name");
    const toolStatus = fragment.querySelector(".tool-status");
    const toolResult = fragment.querySelector(".tool-result");

    fragment.querySelector(".message__time").textContent = entry.time || formatTime();
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
  article.classList.add(entry.role === "user" ? "message--user" : "message--assistant");
  fragment.querySelector(".message__role").textContent = entry.role === "user" ? "OPERADOR" : "WRONG GPT";
  fragment.querySelector(".message__time").textContent = entry.time || formatTime();
  fragment.querySelector(".message__content").textContent = entry.content;
  article.dataset.role = entry.role;
  return article;
}

export function renderMessages(messages) {
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
    messages.forEach((entry) => chatLog.appendChild(createMessageNode(entry)));
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

export function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  promptInput.disabled = isBusy;
  sendButton.textContent = isBusy ? "ENVIANDO..." : "☢ ENVIAR ☢";
}

export function setStatus({ ok, model, error, availableModels }, selectedModel) {
  statusBadge.classList.remove("online", "offline");
  if (ok) {
    statusBadge.classList.add("online");
    statusText.innerHTML = githubSvg + "DEV101";
    const allModels = availableModels || [];
    if (allModels.length > 0) {
      const activeModel = selectedModel || model;
      modelSelect.replaceChildren(...allModels.map((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        opt.selected = name === activeModel;
        return opt;
      }));
      modelSelect.disabled = false;
      return selectedModel || model || allModels[0];
    }
    modelSelect.innerHTML = '<option value="">No hay modelos instalados</option>';
    modelSelect.disabled = true;
  } else {
    statusBadge.classList.add("offline");
    statusText.textContent = error ? `FALLO: ${error}` : "ENLACE CORTADO";
    modelSelect.innerHTML = '<option value="">Sin conexion</option>';
    modelSelect.disabled = true;
  }
  return selectedModel;
}
