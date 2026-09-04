export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Incremental server-sent-events parser. Feed raw text chunks via push();
 * parsed events are emitted to the handler as they complete.
 */
export class SseParser {
  private buffer = "";

  constructor(private readonly onEvent: (event: SseEvent) => void) {}

  push(text: string): void {
    this.buffer += text;
    // SSE events are separated by a blank line.
    let sep: { idx: number; len: number } | -1;
    while ((sep = findSeparator(this.buffer)) !== -1) {
      const raw = this.buffer.slice(0, sep.idx);
      this.buffer = this.buffer.slice(sep.idx + sep.len);
      const event = this.parseEvent(raw);
      if (event) this.onEvent(event);
    }
  }

  /** Call at stream end to process a trailing event without a final blank line. */
  flush(): void {
    if (this.buffer.trim().length > 0) {
      const event = this.parseEvent(this.buffer);
      if (event) this.onEvent(event);
    }
    this.buffer = "";
  }

  private parseEvent(raw: string): SseEvent | null {
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.replace(/\r$/, "");
      if (!trimmed || trimmed.startsWith(":")) continue;
      const colon = trimmed.indexOf(":");
      const field = colon === -1 ? trimmed : trimmed.slice(0, colon);
      let value = colon === -1 ? "" : trimmed.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
    }
    if (dataLines.length === 0) return null;
    return { event, data: dataLines.join("\n") };
  }
}

function findSeparator(buffer: string): { idx: number; len: number } | -1 {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return -1;
  if (crlf !== -1 && (lf === -1 || crlf + 2 < lf)) {
    return { idx: crlf, len: 4 };
  }
  return { idx: lf, len: 2 };
}

/** Read a response body as an async iterator of text chunks. */
export async function* iterateTextStream(
  response: Response,
): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
