# mini-api-gateway

基于 Bun + Hono + SQLite 的小型个人 AI API 中转平台（对应 `Task.md` 设计）。

## License

[MIT](./LICENSE)

**一个二进制 + 一个 SQLite 文件 = 一个完整的个人 AI API 中转平台。**

## 功能

- **OpenAI-compatible API**：`POST /v1/chat/completions`、`GET /v1/models`，客户端无需修改（支持 OpenAI SDK 直接接入）
- **Provider 适配**：`openai` / `anthropic`（自动转换请求、响应与 SSE 流）/ `compatible`（DeepSeek、Qwen、vLLM、Ollama 等任意 OpenAI 兼容上游）
- **Model Alias + 多路由**：客户端请求 `gpt`，网关映射到 `openai-main` 的 `gpt-5`；同一别名可配置多条路由按优先级 **Failover**（408/429/5xx/超时/网络错误才切换，400/401/403/404 直接透传）
- **SSE Streaming**：上游流尽量透传，Anthropic 流自动转换为 OpenAI 格式，空闲超时保护
- **API Key 认证**：SHA-256 哈希存储、`scope`（ai/api/both）、模型白名单、配置白名单、RPM 内存限流
- **非 AI HTTP 转发**：`/f/:config`，任意 HTTP API 变成网关上的命名配置，支持简单模板（无模板纯透传）
- **用量统计**：SQLite 记录 request_id / model / provider / tokens / latency / status，按模型、Provider、API Config 维度统计
- **Admin API + Web UI**：浏览器完成 Provider / Model / Key / API Config 配置，敏感 Key 默认脱敏，明文查看需 ADMIN_TOKEN 并写审计日志
- **管理员账号登录**：默认账号 `admin / admin123`（首次启动自动创建，bcrypt 加密存储），支持登录会话、修改密码、密码重置；登录失败等安全事件写入审计日志
- **Settings 页管理员管理**：Web UI 的 Settings 页可创建/禁用/删除管理员、重置密码（禁止自删与禁用最后一个可用管理员）
- **安全**：SSRF 防护（默认禁内网地址与 `file://`）、Header 过滤、请求大小限制、超时控制
- **单机部署**：WAL 模式 SQLite，无 Redis / PostgreSQL 依赖，支持单文件编译与 Docker

## 快速开始

```bash
bun install

# 配置环境变量
cp .env.example .env   # 修改 ADMIN_TOKEN

# 开发
bun run dev

# 健康检查
curl http://localhost:5630/health
```

浏览器打开 `http://localhost:5630`，用默认管理员账号登录（`admin / admin123`，登录后请右上角修改密码），依次配置：

```
Provider (上游地址+Key) → Model (别名→上游模型) → API Key (发给客户端)
```

客户端使用（OpenAI SDK）：

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-personal",                      // Admin UI 创建的 Key
  baseURL: "http://localhost:5630/v1",
});

const res = await client.chat.completions.create({
  model: "gpt",                               // Model Alias
  messages: [{ role: "user", content: "你好" }],
});
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `5630` | 监听端口 |
| `DATABASE_PATH` | `./data/gateway.db` | SQLite 路径（Docker 内为 `/data/gateway.db`） |
| `ADMIN_TOKEN` | - | Admin API 静态令牌（脚本访问与密码重置用），未设置则仅支持账号密码登录 |
| `ADMIN_DEFAULT_USERNAME` | `admin` | 首次启动创建的默认管理员用户名 |
| `ADMIN_DEFAULT_PASSWORD` | `admin123` | 默认管理员初始密码（**登录后请立即修改**） |
| `ADMIN_SESSION_TTL_HOURS` | `24` | 登录会话有效期（小时） |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `ALLOW_PRIVATE_UPSTREAMS` | 关 | 本机部署 Ollama 等私有上游时设为 `1`（放宽 SSRF 校验） |
| `REQUEST_SIZE_LIMIT_MB` | `10` | 请求体大小限制 |
| `REQUEST_TIMEOUT_MS` | `120000` | 非 AI 转发默认超时 |
| `STREAM_IDLE_TIMEOUT_MS` | `60000` | 流式空闲超时 |

## 单文件编译

```bash
bun run build      # 产物: dist/mini-api-gateway(.exe)
./dist/mini-api-gateway
```

Web UI 已内嵌进二进制，无需额外静态文件。类型检查：`bun run check`。

## Docker

```bash
docker build -t mini-api-gateway .
docker run -d --name ai-gateway \
  -p 5630:5630 \
  -v ./data:/data \
  -e ADMIN_TOKEN=change-me \
  mini-api-gateway
```

## API 一览

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 无 | 健康检查 |
| GET | `/v1/models` | API Key | OpenAI 兼容模型列表 |
| POST | `/v1/chat/completions` | API Key | Chat（`stream: true` 走 SSE） |
| POST/GET/... | `/f/:config` | API Key | 非 AI HTTP 转发 |
| POST | `/admin/auth/login` | 无 | 管理员登录（返回会话 token） |
| POST | `/admin/auth/logout` | 会话/静态 Token | 注销当前会话 |
| GET | `/admin/auth/me` | 会话/静态 Token | 当前登录身份 |
| PUT | `/admin/auth/password` | 会话 | 修改自己的密码（需当前密码） |
| POST | `/admin/auth/reset` | 仅静态 Token | 重置指定管理员密码为默认值 |
| POST | `/admin/auth/users` | 仅静态 Token | 创建额外管理员账号 |
| GET | `/admin/auth/users` | 会话/静态 Token | 管理员用户列表（不含密码哈希） |
| PUT | `/admin/auth/users/:id` | 会话/静态 Token | 重置指定用户密码 / 启用禁用 |
| DELETE | `/admin/auth/users/:id` | 会话/静态 Token | 删除管理员用户（保护最后一个可用管理员） |
| GET/POST/PUT/DELETE | `/admin/providers[...]` | Admin Token | Provider CRUD |
| GET | `/admin/providers/:id/token` | Admin Token | Provider Key 明文（记审计） |
| GET/POST/PUT/DELETE | `/admin/models[...]` | Admin Token | Model Alias CRUD |
| GET/POST/DELETE | `/admin/model-routes[...]` | Admin Token | 多路由 Failover 配置 |
| GET/POST/DELETE | `/admin/api-keys[...]` | Admin Token | API Key 管理 |
| GET | `/admin/api-keys/:id/configs` | Admin Token | Key→配置映射 |
| GET/POST/PUT/DELETE | `/admin/api-configs[...]` | Admin Token | 非 AI 配置 CRUD |
| GET | `/admin/api-configs/:id/stats` | Admin Token | 按配置统计 |
| GET | `/admin/api-configs/:id/token` | Admin Token | 配置 Key 明文（记审计） |
| GET | `/admin/stats` | Admin Token | 今日统计（请求/Token/错误/延迟） |
| GET | `/admin/usage` | Admin Token | 用量明细 |
| GET | `/admin/logs` | Admin Token | 审计日志（Key 查看） |

错误格式统一为 OpenAI 风格：

```json
{ "error": { "message": "Model not found", "type": "not_found_error", "code": "model_not_found" } }
```

## 非 AI 转发示例

```bash
# 创建配置（Admin Token）
curl -X POST http://localhost:5630/admin/api-configs \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "name": "weather",
    "url": "https://api.example.com/weather",
    "method": "POST",
    "headers": { "Authorization": "Bearer ${SECRET}" },
    "requestTemplate": { "city": "{{body.city}}" },
    "responseTemplate": { "content": "{{data.result}}" }
  }'

# 调用（API Key）
curl -X POST http://localhost:5630/f/weather \
  -H "Authorization: Bearer sk-personal" \
  -H "content-type: application/json" \
  -d '{"city": "Hangzhou"}'
# => {"content": "sunny in Hangzhou"}
```

## 测试

```bash
bun run check             # TypeScript 类型检查
bun scripts/run-smoke.ts  # 38 项端到端冒烟测试（含 mock 上游）
```

## 项目结构

```
src/
├── index.ts              # Hono 入口、中间件编排、错误处理
├── web-assets.ts         # Web UI 内嵌
├── config/config.ts      # 环境变量配置
├── db/                   # SQLite 连接 / 迁移 / 查询
├── auth/                 # 认证辅助
├── middleware/           # api-key / rate-limit / request-log
├── router/               # 模型路由 + Failover
├── providers/            # openai / anthropic / compatible + factory
├── transform/            # 路径模板引擎
├── routes/               # chat / models / forward / admin
└── utils/                # crypto / id / sse / ssrf / http / logger
web/                      # 管理页面（构建时内嵌）
scripts/                  # mock 上游 + 冒烟测试
```
