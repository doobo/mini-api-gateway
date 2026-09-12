import { OpenAIProvider } from "./openai";
import { fetchUpstream, filterResponseHeaders } from "../utils/http";
import { UpstreamStatusError } from "../utils/http-error";
import { SseParser, iterateTextStream } from "../utils/sse";
import type { SseEvent } from "../utils/sse";
import type {
  ChatCompletionResult,
  ProviderRequest,
} from "./types";

/**
 * Anthropic provider (spec section 9): converts OpenAI-format requests to
 * Anthropic Messages API format and converts responses (including SSE
 * streaming) back to OpenAI-compatible format. Clients never know the
 * upstream is Anthropic.
 */
export class AnthropicProvider extends OpenAIProvider {
  protected override endpoint(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return `${base}${path}`;
  }

  protected override headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (this.config.apiKey) {
      headers["x-api-key"] = this.config.apiKey;
    }
    return headers;
  }

  /** OpenAI messages -> Anthropic system + messages. */
  private convertMessages(rawBody: Record<string, unknown>): {
    system: string | null;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  } {
    const messages = Array.isArray(rawBody.messages) ? rawBody.messages : [];
    const out: Array<{ role: "user" | "assistant"; content: string }> = [];
    let system: string | null = null;

    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const role = (msg as { role?: unknown }).role;
      const content = (msg as { content?: unknown }).content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((part) =>
                  part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
                    ? (part as { text: string }).text
                    : "",
                )
                .join("")
            : "";
      if (role === "system") {
        system = system ? `${system}\n${text}` : text;
      } else if (role === "user" || role === "assistant") {
        out.push({ role, content: text });
      }
    }
    return { system, messages: out };
  }

  private toAnthropicBody(request: ProviderRequest, stream: boolean): Record<string, unknown> {
    const { system, messages } = this.convertMessages(request.rawBody);
    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens ?? 4096,
      stream,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    return body;
  }

  /** Anthropic content blocks -> single text. */
  private extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((block) =>
          block && typeof block === "object" && (block as { type?: unknown }).type === "text"
            ? String((block as { text?: unknown }).text ?? "")
            : "",
        )
        .join("");
    }
    return "";
  }

  override async chat(request: ProviderRequest): Promise<ChatCompletionResult> {
    const response = await fetchUpstream(this.endpoint("/messages"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.toAnthropicBody(request, false)),
      timeoutMs: this.config.requestTimeoutMs,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new UpstreamStatusError(
        response.status,
        `Upstream ${response.status}: ${text.slice(0, 500) || response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      id?: string;
      model?: string;
      role?: string;
      content?: unknown;
      stop_reason?: string | null;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const inputTokens = json.usage?.input_tokens ?? 0;
    const outputTokens = json.usage?.output_tokens ?? 0;
    return {
      id: json.id ?? `chatcmpl-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: json.model ?? request.model,
      message: {
        role: "assistant",
        content: this.extractText(json.content),
      },
      finish_reason: json.stop_reason === "max_tokens" ? "length" : json.stop_reason === "stop_sequence" ? "stop" : json.stop_reason ?? null,
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      headers: filterResponseHeaders(response.headers),
    };
  }

  override async chatStream(request: ProviderRequest): Promise<Response> {
    const response = await fetchUpstream(this.endpoint("/messages"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.toAnthropicBody(request, true)),
      timeoutMs: 0,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new UpstreamStatusError(
        response.status,
        `Upstream ${response.status}: ${text.slice(0, 500) || response.statusText}`,
      );
    }

    // Transform Anthropic SSE -> OpenAI SSE.
    const id = `chatcmpl-anthropic-${Date.now()}`;
    const model = request.model;
    const upstream = response;
    let usagePrompt = 0;
    let usageCompletion = 0;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        const handleEvent = (event: SseEvent) => {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            return;
          }
          const type = parsed.type as string | undefined;

          if (type === "content_block_delta") {
            const delta = parsed.delta as { type?: string; text?: string } | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              send({
                id,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  { index: 0, delta: { content: delta.text }, finish_reason: null },
                ],
              });
            }
          } else if (type === "message_start") {
            const message = parsed.message as
              | { usage?: { input_tokens?: number } }
              | undefined;
            usagePrompt = message?.usage?.input_tokens ?? 0;
          } else if (type === "message_delta") {
            const usage = parsed.usage as { output_tokens?: number } | undefined;
            usageCompletion = usage?.output_tokens ?? usageCompletion;
            const delta = parsed.delta as { stop_reason?: string | null } | undefined;
            const finish = delta?.stop_reason === "max_tokens" ? "length" : "stop";
            send({
              id,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: {}, finish_reason: finish }],
              usage: {
                prompt_tokens: usagePrompt,
                completion_tokens: usageCompletion,
                total_tokens: usagePrompt + usageCompletion,
              },
            });
          }
          // message_stop / ping / other events are ignored.
        };

        const parser = new SseParser(handleEvent);
        try {
          for await (const chunk of iterateTextStream(upstream)) {
            parser.push(chunk);
          }
          parser.flush();
        } catch {
          // Upstream stream error mid-flight: emit done and close.
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }
}
