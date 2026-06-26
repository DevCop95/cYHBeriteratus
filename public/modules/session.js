const SESSION_KEY = "ollama-session-id";
const STORAGE_KEY = "ollama-cyber-console-history";

export function getOrCreateSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function loadMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMessages(messages) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch {}
}

export async function restoreSession(sessionId) {
  if (!sessionId) return null;
  try {
    const res = await fetch(`/api/session/${sessionId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.messages) && data.messages.length > 0 ? data.messages : null;
  } catch {
    return null;
  }
}

export async function syncSession(sessionId, messages) {
  if (!sessionId || !messages.length) return;
  try {
    await fetch(`/api/session/${sessionId}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch {}
}

export async function clearSession(sessionId) {
  if (!sessionId) return;
  try {
    await fetch(`/api/session/${sessionId}`, { method: "DELETE" });
  } catch {}
}
