/**
 * Mock OpenAI-compatible upstream used for gateway smoke tests.
 * Routes:
 *   POST /v1/chat/completions        - normal + streaming responses
 *   POST /echo/v1/chat/completions   - reports which body keys it received
 *   POST /fail/500|429|timeout       - error simulation for failover tests
 *   *  /anything                     - echo of method/headers/body (for /f forwarding)
 */
import { Hono } from "hono";

const app = new Hono();

app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const last = body.messages?.[body.messages.length - 1]?.content ?? "";
  if (body.stream) {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        for (const piece of ["Hello", " ", "from", " ", "mock"]) {
          send({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
          });
          await Bun.sleep(10);
        }
        send({
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
        });
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });
  }
  return c.json({
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [
      { index: 0, message: { role: "assistant", content: `echo:${last}` }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
});

// Echoes the JSON body the gateway forwarded, so tests can assert that client
// parameters the gateway does not model reach the upstream untouched.
app.post("/echo/v1/chat/completions", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  return c.json({
    id: "chatcmpl-echo",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: `keys:${Object.keys(body).sort().join(",")}` },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
});

// Fixed-status routes for failover testing (base_url embeds the path).
app.all("/fail500/*", (c) => c.text("upstream fail 500", 500));
app.all("/fail429/*", (c) => c.text("upstream fail 429", 429));
app.all("/fail400/*", (c) => c.text("upstream fail 400", 400));

app.all("/anything", async (c) => {
  let body = null;
  const raw = await c.req.text();
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return c.json({
    method: c.req.method,
    query: c.req.query(),
    body,
    auth: c.req.header("authorization") ?? null,
    // Reported so tests can assert which browser headers were *not* forwarded.
    cookie: c.req.header("cookie") ?? null,
  });
});

app.all("/weather", async (c) => {
  const body = await c.req.json();
  const city = body?.city ?? "unknown";
  return c.json({ result: `sunny in ${city}`, temp: 25 });
});

export default {
  port: 5699,
  fetch: app.fetch,
};
