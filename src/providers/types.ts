export interface ProviderConfig {
  id: number;
  name: string;
  type: "openai" | "anthropic" | "compatible";
  baseUrl: string;
  apiKey: string | null;
  /** Hard timeout for non-streaming upstream calls (REQUEST_TIMEOUT_MS). */
  requestTimeoutMs: number;
}

export interface ProviderRequest {
  model: string;
  messages: unknown[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  /** Original client body (OpenAI format) forwarded as-is. */
  rawBody: Record<string, unknown>;
}

export interface ChatChoiceMessage {
  role: string;
  content: string | null;
}

export interface ChatCompletionResult {
  id: string;
  created: number;
  model: string;
  message: ChatChoiceMessage;
  finish_reason: string | null;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
  /** Upstream response headers to forward (e.g. ratelimit info). */
  headers: Record<string, string>;
}

export interface Provider {
  chat(request: ProviderRequest): Promise<ChatCompletionResult>;
  /** Raw streaming Response from upstream (body is an SSE or byte stream). */
  chatStream(request: ProviderRequest): Promise<Response>;
  models?(): Promise<string[]>;
}
