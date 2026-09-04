import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { CompatibleProvider } from "./compatible";
import type { Provider, ProviderConfig } from "./types";

/** Factory per spec section 36. */
export function createProvider(config: ProviderConfig): Provider {
  switch (config.type) {
    case "openai":
      return new OpenAIProvider(config);
    case "anthropic":
      return new AnthropicProvider(config);
    case "compatible":
      return new CompatibleProvider(config);
    default:
      throw new Error(`Unsupported provider: ${config.type satisfies never}`);
  }
}
