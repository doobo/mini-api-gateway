import {
  getModelByName,
  getProvider,
  listModelRoutesFor,
} from "../db/queries";
import type { ProviderRow } from "../db/queries";
import { notFound, internalError } from "../utils/http-error";
import { createProvider } from "../providers/factory";
import type { ProviderConfig } from "../providers/types";
import { decryptSecret } from "../utils/secretbox";
import { logger } from "../utils/logger";

export interface ResolvedRoute {
  model: string;
  provider: ProviderRow;
  upstreamModel: string;
  priority: number;
}

/**
 * Resolve a model alias to an ordered list of routes (spec sections 11/12).
 * Uses model_routes when configured for the alias; otherwise falls back to
 * the single entry in `models`.
 */
export function resolveRoutes(modelName: string): ResolvedRoute[] {
  const routes = listModelRoutesFor(modelName);

  if (routes.length > 0) {
    return routes
      .map((route) => {
        const provider = getProvider(route.provider_id);
        if (!provider || !provider.enabled) return null;
        return {
          model: modelName,
          provider,
          upstreamModel: route.upstream_model,
          priority: route.priority,
        } satisfies ResolvedRoute;
      })
      .filter((route): route is ResolvedRoute => route !== null);
  }

  const model = getModelByName(modelName);
  if (!model) {
    throw notFound(`Model '${modelName}' not found`, "model_not_found");
  }
  const provider = getProvider(model.provider_id);
  if (!provider || !provider.enabled) {
    throw notFound(`Provider for model '${modelName}' is unavailable`, "provider_unavailable");
  }
  return [
    {
      model: modelName,
      provider,
      upstreamModel: model.upstream_model,
      priority: model.priority,
    },
  ];
}

export function routeProviderConfig(
  route: ResolvedRoute,
  requestTimeoutMs: number,
): ProviderConfig {
  return {
    id: route.provider.id,
    name: route.provider.name,
    type: route.provider.type as ProviderConfig["type"],
    baseUrl: route.provider.base_url,
    // The stored key is encrypted at rest; upstream calls need plaintext.
    apiKey: runtimeProviderKey(route.provider),
    requestTimeoutMs,
  };
}

/**
 * Decrypt the provider key for upstream calls. Fails loudly (502) when the
 * encryption key is lost/mismatched - silently sending ciphertext as a bearer
 * token would turn a config problem into mysterious upstream 401s.
 */
function runtimeProviderKey(provider: ProviderRow): string | null {
  if (!provider.api_key) return null;
  try {
    return decryptSecret(provider.api_key);
  } catch (error) {
    logger.error("provider key decrypt failed", {
      provider_id: provider.id,
      provider: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(
      `Stored API key for provider '${provider.name}' cannot be decrypted - re-enter it in the admin UI (encryption key lost or changed).`,
      "provider_key_undecryptable",
    );
  }
}

export { createProvider };
