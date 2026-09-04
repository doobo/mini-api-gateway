import type { Provider, ProviderConfig, ProviderRequest, ChatCompletionResult } from "./types";
import { fetchUpstream, filterResponseHeaders } from "../utils/http";
import { UpstreamStatusError } from "../utils/http-error";

export class OpenAIProvider implements Provider {
  constructor(protected readonly config: ProviderConfig) {}

  protected endpoint(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return `${base}${path}`;
  }

  protected headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.config.apiKey) {
      headers["authorization"] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  protected buildBody(request: ProviderRequest): Record<string, unknown> {
    return {
      ...request.rawBody,
      model: request.model,
      stream: false,
    };
  }

  protected buildStreamBody(request: ProviderRequest): Record<string, unknown> {
    return {
      ...request.rawBody,
      model: request.model,
      stream: true,
    };
  }

  async chat(request: ProviderRequest): Promise<ChatCompletionResult> {
    const response = await fetchUpstream(this.endpoint("/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(request)),
      timeoutMs: 120_000,
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
      created?: number;
      model?: string;
      choices?: Array<{
        message?: { role?: string; content?: string | null };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = json.choices?.[0];
    const usage = json.usage;
    return {
      id: json.id ?? `chatcmpl-${Date.now()}`,
      created: json.created ?? Math.floor(Date.now() / 1000),
      model: json.model ?? request.model,
      message: {
        role: choice?.message?.role ?? "assistant",
        content: choice?.message?.content ?? null,
      },
      finish_reason: choice?.finish_reason ?? null,
      usage: usage
        ? {
            prompt_tokens: usage.prompt_tokens ?? 0,
            completion_tokens: usage.completion_tokens ?? 0,
            total_tokens: usage.total_tokens ?? 0,
          }
        : null,
      headers: filterResponseHeaders(response.headers),
    };
  }

  async chatStream(request: ProviderRequest): Promise<Response> {
    const response = await fetchUpstream(this.endpoint("/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildStreamBody(request)),
      timeoutMs: 0, // No timeout for streams; handled by idle timeout at gateway level.
    });
    if (!response.ok) {
      const text = await response.text();
      throw new UpstreamStatusError(
        response.status,
        `Upstream ${response.status}: ${text.slice(0, 500) || response.statusText}`,
      );
    }
    return response;
  }

  async models(): Promise<string[]> {
    const response = await fetchUpstream(this.endpoint("/models"), {
      method: "GET",
      headers: this.headers(),
      timeoutMs: 15_000,
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  }
}
