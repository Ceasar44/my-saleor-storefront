# Next.js Agent BFF 实现与 Adapter 交接

本轮只修改 Storefront 仓库。Next.js 已实现签名和 visitor Cookie，仍需 Adapter 按协议实现验证器及 scope/runner 装配后才能真实联通。功能开关继续默认关闭。

## 服务端入口

- `POST /api/agent/session`：同源初始化；复用现有 Saleor session，签发或读取 Agent visitor Cookie。响应仅含 `visitorId`、`resetThread`、`authStatus`，Cache-Control 为 no-store。
- `POST /api/agent`：先校验同源和输入，再读取同一 session 与受保护 Cookie。Cookie 新建、身份轮换或浏览器 visitor 提示不匹配时，返回 `409 {"error":"agent_identity_reset"}`，不调用 Adapter。
- 两个入口显式使用 Node.js runtime。Cookie 在响应开始前通过 Next.js cookies() 写入，原 SSE 转发仍保持流式。
- 成功请求使用 `prepareAdapterRequest()` 对最终正文签名。浏览器 Cookie、Authorization 和伪造的签名头不透传到 Adapter。

## 环境配置

必须配置 `.env.example` 中的服务端变量：

```dotenv
AGENT_ADAPTER_URL=https://adapter.example.com/api/agent
AGENT_BFF_ISSUER=paper-storefront
AGENT_BFF_AUDIENCE=agent-adapter
AGENT_BFF_KEY_ID=key-1
AGENT_TENANT_ID=tenant-1
AGENT_STORE_ID=store-1
AGENT_BFF_SIGNING_SECRET=<base64 随机密钥>
AGENT_VISITOR_COOKIE_SECRET=<另一份 base64 随机密钥>
```

两个密钥必须不同，各自解码为 32–128 字节，采用规范 base64 编码。签名密钥与 Adapter 共享，visitor Cookie 密钥仅用于 Next.js。密钥必须只出现在服务端环境配置中。

URL 是完整的 `/api/agent` 或 `/agui` 端点，不允许 credentials、query、fragment。生产必须 HTTPS；开发 HTTP 仅允许 localhost/127.0.0.1/IPv6 loopback。本仓库未写入真实部署地址或生成真实密钥。

配置按请求读取，缺少或非法配置对外返回不可用；不会因为构建导入模块就要求配置秘密。登出清理 Cookie 不依赖签名配置。

## visitor 生命周期

生产 Cookie：`__Host-paper-agent-visitor`；开发 Cookie：`paper-agent-visitor-dev`。HttpOnly、SameSite=Lax、Path=/，生产 Secure，无 Domain，最长 30 天。

内容为签名保护的 visitor ID、scope、期限和最近已验证的用户绑定；不是 Saleor token，不取代 Saleor session。Cookie 签名使用独立用途前缀与密钥。

- anonymous → authenticated 保留 visitor/thread，并更新 Cookie 中的用户绑定。
- 已绑定用户 → guest 或另一用户：轮换 visitor，前端重置 thread、消息、待执行工具。
- unavailable 保留已有绑定，不假定用户已经退出。
- Cookie 缺失、被篡改、过期、scope 不符：生成新 visitor，不认领旧 localStorage 身份。
- logout 成功后删除生产/开发两个 Agent Cookie，并沿用现有前端 visitor/thread 清理。

浏览器启动时先完成 session 初始化；同一页面并发初始化合并为一条请求，但不长期缓存认证结果。初始化失败显示不可用，现有“新会话”按钮可重试。localStorage 只记录服务端确认的公开 visitor 提示。

收到明确的身份重置 409 后，Provider 取消旧 run、重新初始化并新建 thread；不会自动重放用户消息或购物车 mutation。普通 409 冲突不当成身份重置。

## Adapter 必须匹配的 v1 协议

头：`X-Storefront-Authorization: v1.<kid>.<payload>.<signature>`。

payload 为 UTF-8 JSON 的无填充 base64url，字段顺序不作为接收端重新序列化依据。字段含 iss/aud/iat/exp/jti/scope/identity。有效期 60 秒，每个独立请求使用新的 UUID jti。身份中只有 authenticated 携带 saleor_user_id；不会签发 approvals。

HMAC 输入是以下六项用 LF 连接，无末尾 LF：`v1`、`kid`、`POST`、Adapter pathname、实际 body UTF-8 字节的 SHA256 小写 hex、原始 payload base64url。算法固定 HMAC-SHA256；输出无填充 base64url。

固定向量在 [bff-signature-v1.json](../src/agent/agui/fixtures/bff-signature-v1.json)，由 Python 标准库独立计算并冻结，Node 测试直接比较完整认证头。其中 key 仅供测试，禁止部署使用。

Adapter 仍需实现：验签/时效/scope、数据库原子 nonce 防重放、可信上下文构造、AG-UI 启动装配。现有 AG-UI JSON 正文和工具回执格式未改变。普通身份签名不会绕过后端 FrontendConfirmationVerifier。

Adapter active run 当前存于进程内，初次联调须确保工具回执回到原 worker；签名协议本身不解决 run 路由问题。

## 验证命令

```powershell
# 可使用本地官方 Saleor 3.23 SDL 做静态验证，不代表连接真实 Saleor。
$env:NEXT_PUBLIC_SALEOR_API_URL = '<实际 API 地址或本地官方 schema.graphql>'
pnpm run verify
pnpm exec playwright test --config playwright.agent.config.ts
```

新增测试覆盖固定签名向量、正文/路径改变、独立请求签名、无浏览器凭据透传、配置校验、Cookie 签发/篡改/过期/身份变化/退出，以及初始化和不重放行为。浏览器 fixture 的 session/SSE 为模拟接口，不能替代真实 Next.js → Adapter 联调。

本轮结果：`pnpm run verify` 通过，136 个测试文件、946 项测试全部通过；ESLint 0 errors、25 条原有 warnings。GraphQL 生成使用本地官方 Saleor 3.23 SDL。独立 Playwright 3 项通过，包含 409 身份重置后不重放动作；`git diff --check` 通过。尚未进行真实 Adapter 联调，本轮未执行完整生产构建。
