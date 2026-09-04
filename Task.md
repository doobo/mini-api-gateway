# Personal AI Gateway

> 基于 Bun + Hono + SQLite 构建的小型个人 AI API 中转平台，使用Typescript语法，方便后续代码维护。
> 目标：**单机、轻量、易配置、快速打包、兼容 OpenAI API**。

---

## 1. 项目目标

构建一个个人使用的 AI API Gateway，对外提供统一的 OpenAI-compatible API：
```text
Client
  │
  │ OpenAI API
  ▼
┌──────────────────────┐
│    Personal Gateway  │
│                      │
│ API Key              │
│ Model Alias          │
│ Rate Limit           │
│ Router               │
│ Provider Adapter     │
│ Usage Statistics     │
└──────────┬───────────┘
           │
     ┌─────┼─────────────┐
     ▼     ▼             ▼
   OpenAI Claude      Compatible
                         │
                  ┌──────┼──────┐
                  ▼      ▼      ▼
               DeepSeek Qwen  Ollama

           │
           ▼
        SQLite
```

核心目标：

* 支持主要 AI Provider
* 支持 OpenAI-compatible API
* 支持非 AI HTTP API 转发
* 统一 API Key
* 模型别名
* Provider 路由
* 简单 Failover
* SSE Streaming
* SQLite 调用统计
* Web 管理页面
* 单机运行
* 单文件编译
* Docker 部署
* 不依赖 Redis / PostgreSQL

---

# 2. 非目标

第一版明确不做：

* 多租户
* OAuth
* RBAC
* Kubernetes
* Redis
* PostgreSQL
* 消息队列
* 分布式限流
* Prometheus
* 复杂工作流
* 企业级 IAM
* 复杂 Policy DSL

这是一个**个人工具**，优先考虑：

> 简单 > 完整
> 可维护 > 高并发
> 快速部署 > 企业架构

---

# 3. 技术栈

| 模块            | 技术                    |
| ------------- | --------------------- |
| Runtime       | Bun                   |
| Language      | TypeScript            |
| HTTP          | Hono                  |
| Database      | SQLite                |
| SQLite Driver | `bun:sqlite`          |
| Validation    | Zod                   |
| HTTP Client   | `fetch`               |
| Frontend      | HTML + 少量 JS          |
| Build         | `bun build --compile` |
| Container     | Docker                |

原则：

**尽量少依赖第三方库。**

第一版甚至不使用 ORM。

SQLite 直接通过：

```typescript
import { Database } from "bun:sqlite";
```

访问。

---

# 4. 项目结构

```text
personal-ai-gateway/
│
├── src/
│   ├── index.ts
│   │
│   ├── config/
│   │   └── config.ts
│   │
│   ├── db/
│   │   ├── db.ts
│   │   ├── migrate.ts
│   │   └── queries.ts
│   │
│   ├── auth/
│   │   └── api-key.ts
│   │
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── rate-limit.ts
│   │   └── request-log.ts
│   │
│   ├── router/
│   │   └── model-router.ts
│   │
│   ├── providers/
│   │   ├── types.ts
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   └── compatible.ts
│   │
│   ├── transform/
│   │   └── template.ts
│   │
│   ├── usage/
│   │   └── usage.ts
│   │
│   ├── routes/
│   │   ├── chat.ts
│   │   ├── models.ts
│   │   └── admin.ts
│   │
│   └── utils/
│       ├── crypto.ts
│       └── id.ts
│
├── web/
│   ├── index.html
│   ├── app.js
│   └── style.css
│
├── data/
│   └── .gitkeep
│
├── Dockerfile
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
└── README.md
```

---

# 5. API 设计

## 5.1 Chat Completions

```http
POST /v1/chat/completions
```

请求：

```json
{
  "model": "gpt",
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ],
  "stream": false
}
```

认证：

```http
Authorization: Bearer sk-personal
```

Gateway 根据：

```text
model = gpt
```

查找：

```text
gpt
 ↓
Model Alias
 ↓
Provider
 ↓
Upstream Model
```

例如：

```text
gpt
 ↓
OpenAI
 ↓
gpt-5
```

---

## 5.2 非 AI API 转发

通用 HTTP API 转发，与 AI Chat 完全独立：

```http
POST /f/:config
```

`:config` 为管理后台创建的 API 配置名，任意 HTTP 方法均可，上游 method 由配置决定。

认证与 AI Chat 相同：

```http
Authorization: Bearer sk-personal
```

例如：

```bash
curl -X POST http://localhost:5630/f/weather \
  -H "Authorization: Bearer sk-personal" \
  -d '{"city": "Hangzhou"}'
```

---

# 6. 支持的 API

第一版只需要实现：

```text
POST /v1/chat/completions
GET  /v1/models
POST /f/:config
```

第二阶段：

```text
POST /v1/responses
POST /v1/embeddings
```

暂时不实现：

```text
/v1/audio/*
/v1/images/*
```

除非实际需要。

---

# 7. Provider 设计

统一接口：

```typescript
export interface Provider {
  chat(
    request: ProviderRequest
  ): Promise<Response>;

  models?(): Promise<string[]>;
}
```

请求：

```typescript
export interface ProviderRequest {
  model: string;
  messages: unknown[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  rawBody: unknown;
}
```

Provider 类型：

```text
openai
anthropic
compatible
```

非 AI HTTP API 不走 Provider，走独立的 API Config（§17）。

---

# 8. OpenAI Provider

配置：

```json
{
  "type": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "..."
}
```

请求：

```text
Gateway
  ↓
POST {baseUrl}/chat/completions
```

Header：

```http
Authorization: Bearer {apiKey}
Content-Type: application/json
```

请求 Body 基本保持 OpenAI 格式。

---

# 9. Anthropic Provider

Anthropic API 与 OpenAI API 存在格式差异。

因此：

```text
OpenAI Request
      ↓
Anthropic Adapter
      ↓
Anthropic Request
```

例如：

```text
messages
system
model
max_tokens
```

需要转换。

响应也转换成：

```text
OpenAI-compatible response
```

客户端永远不需要知道后端是 Anthropic。

---

# 10. Compatible Provider

这是第一版最重要的 Provider。

任何 OpenAI-compatible API 都可以：

```json
{
  "type": "compatible",
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "xxx"
}
```

因此可以支持：

```text
DeepSeek
Qwen
SiliconFlow
vLLM
Ollama
LM Studio
其他 OpenAI-compatible 服务
```

无需分别实现 Adapter。

---

# 11. Model Alias

数据库中的模型：

```text
id
name
provider_id
upstream_model
enabled
priority
```

例如：

```text
name: gpt
provider: openai-main
upstream_model: gpt-5
```

客户端：

```json
{
  "model": "gpt"
}
```

实际：

```text
gpt
 ↓
openai-main
 ↓
gpt-5
```

---

# 12. 多 Provider 路由

允许一个模型配置多个 Provider：

```text
gpt
├── openai-main
├── openai-backup
└── azure
```

每个 Route：

```text
provider_id
model
priority
weight
enabled
```

第一版路由策略：

```text
1. enabled
2. priority
3. failover
```

例如：

```text
OpenAI Primary
    ↓ 失败
OpenAI Backup
    ↓ 失败
Azure
```

---

# 13. Failover

只针对以下错误进行 Failover：

```text
408
429
500
502
503
504
timeout
network error
```

不要对所有 HTTP 错误自动重试。

例如：

```text
401
403
400
404
```

直接返回。

避免：

```text
错误 API Key
 ↓
不断重试
 ↓
浪费请求
```

---

# 14. API Key

客户端使用：

```http
Authorization: Bearer sk-personal
```

数据库不要保存完整 API Key。

保存：

```text
id
name
prefix
key_hash
enabled
expires_at
rate_limit
created_at
last_used_at
```

生成：

```text
sk-xxxxxxxxxxxxxxxx
```

数据库：

```text
SHA-256(full_key)
```

验证：

```text
Authorization
      ↓
提取 Bearer
      ↓
SHA-256
      ↓
查询 key_hash
      ↓
验证 enabled
      ↓
允许请求
```

---

# 15. API Key 模型权限

API Key 可以限制模型：

```json
{
  "allowedModels": [
    "gpt",
    "claude",
    "deepseek"
  ]
}
```

请求：

```text
model = gpt
```

允许。

请求：

```text
model = internal-model
```

拒绝：

```http
403 Forbidden
```

---

# 16. Rate Limit

个人版使用内存限流即可。

结构：

```typescript
Map<string, RateBucket>
```

例如：

```text
API Key
 ↓
60 RPM
```

超过：

```http
429 Too Many Requests
```

注意：

内存限流只适用于单进程。

本项目明确：

> 第一版只支持单实例。

---

# 17. 非 AI API 转发（通用 HTTP API）

非 AI 模式的核心能力：把任意 HTTP API 变成 Gateway 上的一个命名配置。

与 AI Provider（§7-§10）完全独立：不经过 Model Alias，不做 messages 转换。

调用方式：

```http
POST /f/:config
```

处理流程：

```text
Client
  ↓
API Key Auth + Rate Limit（复用 AI 链路）
  ↓
API Config Lookup
  ↓
渲染请求模板（无模板则原样透传 body）
  ↓
上游 HTTP API
  ↓
渲染响应模板（无模板则原样透传响应）
  ↓
记录用量（kind = api）
  ↓
Client
```

配置结构：

```json
{
  "name": "weather",
  "description": "天气查询 API",
  "method": "POST",
  "url": "https://api.example.com/weather",
  "headers": {
    "Authorization": "Bearer ${API_SECRET}"
  },
  "requestTemplate": {
    "city": "{{body.city}}"
  },
  "responseTemplate": {
    "content": "{{data.result}}"
  },
  "timeoutMs": 15000,
  "enabled": true
}
```

规则：

```text
✓ 上游 method 由配置决定，客户端统一请求 /f/:config
✓ query 参数原样附加到上游 URL
✓ 请求/响应模板可选，无模板 = 纯透传
✓ 复用 API Key 认证和限流
```

数据库结构：

```sql
CREATE TABLE api_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL UNIQUE,

  description TEXT,

  method TEXT DEFAULT 'POST',

  url TEXT NOT NULL,

  headers TEXT,

  request_template TEXT,

  response_template TEXT,

  api_key TEXT,

  timeout_ms INTEGER DEFAULT 15000,

  enabled INTEGER DEFAULT 1,

  created_at INTEGER NOT NULL,

  updated_at INTEGER NOT NULL
);
```

`headers`、`request_template`、`response_template` 保存 JSON。

Token 管理：

```text
api_key 字段保存上游服务的认证凭证（可选）
管理后台默认脱敏显示 ab****yz
GET /admin/api-configs/:id/token 返回明文（需 ADMIN_TOKEN，记录审计日志）
```

---

# 18. Template Engine

第一版只实现简单路径。

AI Provider 模板：

```text
{{model}}
{{messages}}
{{messages[-1].content}}
{{temperature}}
{{max_tokens}}
```

非 AI API 模板（§17）：

```text
{{body}}
{{body.xxx}}
{{headers.xxx}}
{{query.xxx}}
```

例如：

```json
{
  "prompt": "{{messages[-1].content}}",
  "model": "{{model}}"
}
```

不要第一版引入完整 JavaScript 执行环境。

原因：

> 自定义 JS Transformer 会带来严重的安全和维护成本。

---

# 19. Streaming

支持：

```json
{
  "stream": true
}
```

统一输出：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Gateway 原则：

```text
Upstream SSE
     ↓
尽量透传
     ↓
Client
```

对于 Anthropic 等非 OpenAI 格式 Provider：

```text
Anthropic Stream
       ↓
Adapter
       ↓
OpenAI SSE
       ↓
Client
```

---

# 20. Usage 统计

SQLite：

```sql
CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  request_id TEXT NOT NULL,

  api_key_id INTEGER,

  kind TEXT DEFAULT 'ai',

  model TEXT,
  provider TEXT,

  api_config_id INTEGER,

  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,

  latency_ms INTEGER,

  status INTEGER,

  stream INTEGER DEFAULT 0,

  error TEXT,

  created_at INTEGER NOT NULL
);
```

---

# 21. 统计指标

首页显示：

```text
今日请求
今日 Token
今日成功率
平均延迟
```

模型统计：

```text
Model       Requests    Tokens
--------------------------------
gpt         532         1.2M
claude      421         980K
deepseek    331         620K
```

Provider：

```text
Provider        Requests    Errors
-----------------------------------
OpenAI          800         3
Anthropic       421         1
DeepSeek        331         2
```

非 AI API 配置统计（按 api_config 维度，§17）：

```text
API Config      Requests    Errors    Avg Latency
---------------------------------------------------
weather         1,204       2         89ms
translate       532         0         210ms
ocr             88          1         1.2s
```

说明：

```text
AI 请求     → 按 model / provider 维度统计
非 AI 请求  → 按 api_config 维度统计（kind = api）
两者共用 usage_logs，通过 kind 区分
```

---

# 22. Token 获取策略

优先使用 Provider 返回的：

```json
{
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 200,
    "total_tokens": 300
  }
}
```

如果 Provider 没有返回 Token：

```text
input_tokens = 0
output_tokens = 0
```

第一版不要自己实现 Tokenizer。

原因：

不同模型 Tokenizer 不同。

---

# 23. 请求生命周期

标准请求：

```text
Client
  │
  ▼
Hono
  │
  ▼
Request ID
  │
  ▼
API Key Auth
  │
  ▼
Rate Limit
  │
  ▼
Model Lookup
  │
  ▼
Route Selection
  │
  ▼
Provider Adapter
  │
  ▼
Upstream API
  │
  ▼
Response Adapter
  │
  ▼
Usage Record
  │
  ▼
Client
```

---

# 24. Request ID

每次请求生成：

```text
req_xxxxxxxxx
```

返回：

```http
X-Request-ID: req_xxxxxxxxx
```

日志：

```text
request_id
model
provider
latency
status
```

出现问题时可以通过：

```text
X-Request-ID
```

定位请求。

---

# 25. 超时

默认：

```text
Connect timeout: 10s
Request timeout: 120s
```

Streaming：

```text
不使用固定 response timeout
```

而是：

```text
idle timeout
```

例如：

```text
60 秒没有任何数据
→ timeout
```

---

# 26. Provider 配置

推荐数据库结构：

```sql
CREATE TABLE providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL UNIQUE,

  type TEXT NOT NULL,

  base_url TEXT NOT NULL,

  api_key TEXT,

  enabled INTEGER DEFAULT 1,

  created_at INTEGER NOT NULL,

  updated_at INTEGER NOT NULL
);
```

注意：

个人版可以先保存 Provider API Key。

但生产环境建议至少进行加密存储。

管理后台展示（§30）：

```text
列表/详情 → 脱敏显示 sk-abc****wxyz
查看明文  → GET /admin/providers/:id/token（需 ADMIN_TOKEN，记录审计日志）
```

不要在列表接口中直接返回明文。

---

# 27. Models

```sql
CREATE TABLE models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL UNIQUE,

  provider_id INTEGER NOT NULL,

  upstream_model TEXT NOT NULL,

  enabled INTEGER DEFAULT 1,

  priority INTEGER DEFAULT 100,

  created_at INTEGER NOT NULL,

  FOREIGN KEY(provider_id)
    REFERENCES providers(id)
);
```

---

# 28. Model Routes

如果需要 Failover：

```sql
CREATE TABLE model_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  model_name TEXT NOT NULL,

  provider_id INTEGER NOT NULL,

  upstream_model TEXT NOT NULL,

  priority INTEGER DEFAULT 100,

  weight INTEGER DEFAULT 100,

  enabled INTEGER DEFAULT 1
);
```

第一版可以直接：

```text
models
```

完成。

等需要多 Provider 后再启用：

```text
model_routes
```

---

# 29. API Keys

```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL,

  prefix TEXT NOT NULL,

  key_hash TEXT NOT NULL UNIQUE,

  scope TEXT DEFAULT 'both',

  allowed_models TEXT,

  allowed_apis TEXT,

  rate_limit INTEGER DEFAULT 60,

  enabled INTEGER DEFAULT 1,

  expires_at INTEGER,

  created_at INTEGER NOT NULL,

  last_used_at INTEGER
);
```

`allowed_models` 保存 JSON（AI 模型权限）：

```json
[
  "gpt",
  "claude",
  "deepseek"
]
```

`allowed_apis` 保存可调用的非 AI 配置名（§17）：

```json
[
  "weather",
  "translate"
]
```

`scope` 控制用途：

```text
ai     → 只能调 /v1/*（AI Chat）
api    → 只能调 /f/*（非 AI 转发）
both   → 都可以，默认
```

`allowed_models` / `allowed_apis` 为 NULL 或空数组时表示不限制。

---

# 30. Admin API

第一版：

```http
GET  /admin/providers
POST /admin/providers
PUT  /admin/providers/:id
DELETE /admin/providers/:id

GET  /admin/models
POST /admin/models
PUT  /admin/models/:id
DELETE /admin/models/:id

GET  /admin/api-keys
POST /admin/api-keys
DELETE /admin/api-keys/:id

GET    /admin/api-configs
POST   /admin/api-configs
PUT    /admin/api-configs/:id
DELETE /admin/api-configs/:id

GET /admin/api-configs/:id/stats

GET /admin/usage
GET /admin/logs
```

非 AI API 配置管理（§17）：

```text
API Configs CRUD + 按配置统计
```

配置对应 Token 查看：

```http
GET /admin/providers/:id/token    → AI Provider 上游 Key 明文
GET /admin/api-configs/:id/token  → 非 AI 配置上游 Key 明文

GET /admin/api-keys/:id/configs   → 该客户端 Key 可调用哪些配置
GET /admin/api-configs/:id/keys   → 该配置被哪些客户端 Key 调用
```

规则：

```text
✓ 列表/详情默认只返回脱敏 Key（ab****yz）
✓ 明文查看需要 ADMIN_TOKEN，并写入审计日志
✓ 审计日志记录：时间、来源 IP、查看的目标配置
```

---

# 31. Admin 认证

个人版不要做完整用户系统。

使用：

```env
ADMIN_TOKEN=xxxxxxxx
```

请求：

```http
Authorization: Bearer xxxxxxxx
```

管理 API：

```text
/admin/*
```

必须验证：

```text
ADMIN_TOKEN
```

不要把 Admin API 暴露给普通 API Key。

---

# 32. Web UI

首页：

```text
┌──────────────────────────────────────┐
│ Personal AI Gateway                  │
├──────────────────────────────────────┤
│                                      │
│ Requests       Tokens       Errors   │
│ 12,842         3.2M         23       │
│                                      │
├──────────────────────────────────────┤
│ Models                               │
│                                      │
│ gpt              OpenAI       ON     │
│ claude           Anthropic    ON     │
│ deepseek         Compatible   ON     │
│                                      │
├──────────────────────────────────────┤
│ Recent Requests                      │
│                                      │
│ 10:21 gpt       200    1234ms        │
│ 10:20 claude    200    2134ms        │
│ 10:19 deepseek  429     532ms        │
└──────────────────────────────────────┘
```

管理页面：

```text
Providers     （上游 Token 脱敏 / 明文查看）
Models
API Keys      （scope / allowed_apis / 配置映射）
API Configs   （非 AI HTTP API 配置 + 按配置统计）
Usage
Logs          （含 Token 查看审计）
Settings
```

API Configs 页面：

```text
Name        Method    Upstream URL                  Requests    Errors    Upstream Key
------------------------------------------------------------------------------------
weather     POST      https://api.example.com/wx    1,204       2         ab****yz
translate   POST      https://api.example.com/tr    532         0         sk-****yz
```

---

# 33. 环境变量

`.env.example`：

```env
PORT=5630

DATABASE_PATH=./data/gateway.db

ADMIN_TOKEN=change-me

LOG_LEVEL=info
```

不要把 Provider Key 放进 `.env`。

Provider Key 从 Admin UI 配置。

---

# 34. package.json

```json
{
  "name": "personal-ai-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "build": "bun build src/index.ts --compile --outfile dist/ai-gateway",
    "check": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

版本号以实际安装时的最新兼容版本为准。

---

# 35. Hono Server

核心入口：

```typescript
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({
    status: "ok"
  });
});

app.get("/v1/models", async (c) => {
  // TODO
});

app.post("/v1/chat/completions", async (c) => {
  // TODO
});

app.all("/f/:config", async (c) => {
  // TODO: 非 AI API 转发
});

export default {
  port: Number(process.env.PORT || 5630),
  fetch: app.fetch
};
```

---

# 36. Provider Factory

```typescript
function createProvider(config: ProviderConfig): Provider {
  switch (config.type) {
    case "openai":
      return new OpenAIProvider(config);

    case "anthropic":
      return new AnthropicProvider(config);

    case "compatible":
      return new CompatibleProvider(config);

    default:
      throw new Error(
        `Unsupported provider: ${config.type}`
      );
  }
}
```

---

# 37. Chat Handler

伪代码：

```typescript
async function handleChat(c: Context) {
  const request = await c.req.json();

  // 1. 验证请求
  validateChatRequest(request);

  // 2. 获取 API Key
  const apiKey = await authenticate(c);

  // 3. 检查模型权限
  authorizeModel(apiKey, request.model);

  // 4. 查找模型
  const model = await findModel(request.model);

  // 5. 获取 Provider
  const provider = createProvider(model.provider);

  // 6. 调用上游
  const response = await provider.chat({
    ...request,
    model: model.upstreamModel
  });

  // 7. 记录 Usage
  recordUsage(...);

  return response;
}
```

---

# 38. Error Format

统一返回：

```json
{
  "error": {
    "message": "Model not found",
    "type": "invalid_request_error",
    "code": "model_not_found"
  }
}
```

HTTP：

```text
400 invalid request
401 unauthorized
403 forbidden
404 not found
429 rate limit
500 internal error
502 upstream error
504 upstream timeout
```

---

# 39. 安全要求

必须：

```text
✓ API Key Hash
✓ Admin Token
✓ Provider Secret / 配置 Token 默认脱敏，明文查看需 ADMIN_TOKEN 并记审计日志
✓ SSRF 防护
✓ URL Scheme 限制
✓ Request Size 限制
✓ Timeout
✓ Header 过滤
```

尤其是非 AI API 配置（§17）。

不要允许：

```text
file://
localhost
127.0.0.1
169.254.169.254
内网地址
```

否则可能产生 SSRF。

---

# 40. 自定义 URL SSRF 防护

至少禁止：

```text
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
::1
fc00::/7
```

只允许：

```text
https://
http://
```

如果 Gateway 部署在公网：

> 自定义 Provider URL 和非 AI API 配置 URL 必须进行严格 SSRF 校验。

---

# 41. SQLite WAL

启动时：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

WAL 可以提高读写并发能力。

---

# 42. SQLite 数据库位置

默认：

```text
./data/gateway.db
```

Docker：

```text
/data/gateway.db
```

必须挂载 Volume：

```bash
docker run \
  -p 5630:5630 \
  -v ./data:/data \
  personal-ai-gateway
```

---

# 43. 数据备份

个人版直接备份：

```text
data/gateway.db
```

例如：

```bash
cp data/gateway.db \
   backup/gateway-$(date +%Y%m%d).db
```

因为 SQLite 文件就是整个数据库。

---

# 44. Dockerfile

```dockerfile
FROM oven/bun:alpine

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun build src/index.ts \
    --compile \
    --outfile /app/ai-gateway

RUN mkdir -p /data

VOLUME ["/data"]

EXPOSE 5630

ENV DATABASE_PATH=/data/gateway.db
ENV PORT=5630

CMD ["/app/ai-gateway"]
```

---

# 45. 本地开发

安装依赖：

```bash
bun install
```

开发：

```bash
bun run dev
```

访问：

```text
http://localhost:5630
```

健康检查：

```bash
curl http://localhost:5630/health
```

---

# 46. 编译

执行：

```bash
bun run build
```

得到：

```text
dist/ai-gateway
```

运行：

```bash
./dist/ai-gateway
```

不需要用户安装 Node.js。

---

# 47. Docker 构建

```bash
docker build \
  -t personal-ai-gateway .
```

运行：

```bash
docker run -d \
  --name ai-gateway \
  -p 5630:5630 \
  -v ./data:/data \
  -e ADMIN_TOKEN=change-me \
  personal-ai-gateway
```

---

# 48. OpenAI SDK 使用

客户端：

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-personal",
  baseURL: "http://localhost:5630/v1"
});

const response = await client.chat.completions.create({
  model: "gpt",
  messages: [
    {
      role: "user",
      content: "你好"
    }
  ]
});

console.log(response.choices[0].message);
```

对于客户端来说：

```text
OpenAI
```

和：

```text
Personal Gateway
```

没有区别。

---

# 49. 第一版开发顺序

严格按照下面顺序开发。

## Step 1

创建：

```text
Bun
+
Hono
+
TypeScript
```

实现：

```text
GET /health
```

---

## Step 2

加入 SQLite。

实现：

```text
providers
models
api_keys
usage_logs
```

---

## Step 3

实现 API Key：

```text
Authorization: Bearer xxx
```

---

## Step 4

实现：

```text
GET /v1/models
```

---

## Step 5

实现：

```text
POST /v1/chat/completions
```

首先只支持：

```text
OpenAI-compatible
```

---

## Step 6

实现 Streaming：

```text
stream=true
```

---

## Step 7

增加：

```text
Anthropic Adapter
```

---

## Step 8

增加：

```text
Model Alias
```

---

## Step 9

增加：

```text
Failover
```

---

## Step 10

增加：

```text
Usage Statistics
```

---

## Step 11

增加：

```text
Admin Token
```

---

## Step 12

增加简单 Web UI。

---

## Step 13

增加非 AI API 转发：

```text
POST /f/:config
API Configs 管理
按配置统计
配置 Token 查看
```

---

## Step 14

最终：

```bash
bun run build
```

生成单文件。

---

# 50. MVP 验收标准

完成以下测试才能认为 MVP 完成。

### API Key

```text
无 API Key       → 401
错误 API Key     → 401
正确 API Key     → 200
```

### Model

```text
不存在模型       → 404
无权限模型       → 403
正常模型         → 200
```

### Provider

```text
正常响应         → 200
Provider 429     → Failover
Provider 500     → Failover
Provider timeout → Failover
```

### Streaming

```text
stream=false → JSON
stream=true  → SSE
```

### Usage

每次请求至少记录：

```text
request_id
model
provider
status
latency
created_at
```

如果上游提供 Token：

```text
input_tokens
output_tokens
total_tokens
```

### 非 AI API 转发

```text
无权限配置       → 403
不存在配置       → 404
正常转发         → 200
上游超时         → 504
按配置统计       → /admin/api-configs/:id/stats 有数据
```

### Token 查看

```text
列表接口         → 只返回脱敏 Key
明文查看         → 需 ADMIN_TOKEN
明文查看         → 审计日志有记录
Key→配置映射     → /admin/api-keys/:id/configs 正确
```

---

# 51. 第一版不要做的事情

以下功能全部延后：

```text
Redis
PostgreSQL
Kafka
RabbitMQ
Kubernetes
OAuth
OIDC
RBAC
多租户
复杂权限 DSL
分布式限流
复杂计费系统
实时 Prometheus
```

如果未来真的需要，再引入。

---

# 52. 后续升级路线

## V0.1

```text
Bun
Hono
SQLite

OpenAI-compatible
API Key
Model Alias
Usage
SSE
```

## V0.2

```text
Anthropic
Gemini
Failover
非 AI API 转发
Admin UI
```

## V0.3

```text
Rate Limit
Cost
Model Route
Health Check
Cache
```

## V1.0

只有出现真实需求时再考虑：

```text
Redis
PostgreSQL
Multi-instance
```

---

# 53. 最终架构

最终保持：

```text
                         ┌───────────────┐
                         │   Web Admin   │
                         └───────┬───────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │      Hono + Bun        │
                    │                        │
                    │  Auth                  │
                    │    ↓                   │
                    │  Rate Limit            │
                    │    ↓                   │
                    │  Model Alias           │
                    │    ↓                   │
                    │  Router                │
                    │    ↓                   │
                    │  Provider Adapter      │
                    └───────────┬────────────┘
                                │
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
          OpenAI            Anthropic         Compatible
                                                  │
                                      ┌───────────┼───────────┐
                                      ▼           ▼           ▼
                                   DeepSeek      Qwen       Ollama

                                │
                                ▼
                         ┌──────────────┐
                         │   SQLite     │
                         ├──────────────┤
                         │ Config       │
                         │ API Keys     │
                         │ Models       │
                         │ API Configs  │
                         │ Usage Logs   │
                         └──────────────┘
```

---

# 54. 核心设计原则

整个项目遵循以下原则：

### 1. OpenAI-compatible 优先

客户端尽可能不需要修改。

### 2. Provider 与 Gateway 解耦

Provider 只负责：

```text
请求转换
上游调用
响应转换
```

Gateway 负责：

```text
认证
权限
路由
统计
```

### 3. SQLite-first

单机情况下：

```text
SQLite 足够
```

### 4. 单进程

第一版不考虑分布式。

### 5. 少依赖

优先：

```text
Bun API
Web API
原生 fetch
SQLite
```

### 6. 可编译

最终必须能够：

```bash
bun build --compile
```

生成：

```text
ai-gateway
```

### 7. 配置可视化

Provider、Model、API Key 不要求修改代码。

### 8. 默认安全

特别注意：

```text
API Key
Provider Secret
Admin API
SSRF
Timeout
Request Size
```

---

# 55. 最终产品形态

理想情况下，用户只需要：

```bash
./ai-gateway
```

然后浏览器打开：

```text
http://localhost:5630
```

配置：

```text
Provider
    ↓
Model
    ↓
API Key
```

客户端配置：

```text
Base URL:
http://localhost:5630/v1

API Key:
sk-personal

Model:
gpt
```

非 AI 调用：

```text
POST http://localhost:5630/f/:config
```

即可开始使用。

最终目标：

> **一个二进制 + 一个 SQLite 文件 = 一个完整的个人 AI API 中转平台。**

