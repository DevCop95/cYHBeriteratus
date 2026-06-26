const STREAM_IDLE_TIMEOUT_MS = 120000;

export async function processStream(response, { onToken, onToolCall, onToolResult } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamDone = false;

  const readWithTimeout = () => {
    let tid;
    return Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        tid = setTimeout(
          () => reject(new Error("Timeout del enlace oscuro. Se perdio la trasmision.")),
          STREAM_IDLE_TIMEOUT_MS
        );
      }),
    ]).finally(() => clearTimeout(tid));
  };

  while (!streamDone) {
    const { value, done } = await readWithTimeout();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);

      if (event.type === "token" && event.content) onToken?.(event.content);
      if (event.type === "tool_call") onToolCall?.(event);
      if (event.type === "tool_result") onToolResult?.(event);
      if (event.type === "error") throw new Error(event.error || "Error durante el stream.");
      if (event.type === "done") { streamDone = true; break; }
    }
  }
}
