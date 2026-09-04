import { Hono } from "hono";
import { listModels } from "../db/queries";

export const modelRoutes = new Hono();

/** GET /v1/models - OpenAI-compatible model listing (spec sections 6/48). */
modelRoutes.get("/models", (c) => {
  const models = listModels().filter((m) => m.enabled);
  return c.json({
    object: "list",
    data: models.map((model) => ({
      id: model.name,
      object: "model",
      created: Math.floor(model.created_at / 1000),
      owned_by: "personal-gateway",
    })),
  });
});
