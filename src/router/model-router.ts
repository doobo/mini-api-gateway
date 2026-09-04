import {
  getModelByName,
  getProvider,
  listModelRoutes,
} from "../db/queries";
import type { ProviderRow } from "../db/queries";
import { notFound } from "../utils/http-error";
import { createProvider } from "../providers/factory";
import type { ProviderConfig } from "../providers/types";

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
  const routes = listModelRoutes().filter(
    (route) => route.model_name === modelName,
  );

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

export function routeProviderConfig(route: ResolvedRoute): ProviderConfig {
  return {
    id: route.provider.id,
    name: route.provider.name,
    type: route.provider.type as ProviderConfig["type"],
    baseUrl: route.provider.base_url,
    apiKey: route.provider.api_key,
  };
}

export { createProvider };
