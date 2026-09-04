import { OpenAIProvider } from "./openai";

/**
 * Works with any OpenAI-compatible upstream (DeepSeek, Qwen, SiliconFlow,
 * vLLM, Ollama, LM Studio...). Identical wire format to OpenAI provider
 * (spec section 10) - only the baseUrl/apiKey differ.
 */
export class CompatibleProvider extends OpenAIProvider {}
