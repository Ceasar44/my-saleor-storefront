# Next.js BFF → Adapter 身份验证修改方案

状态：Next.js 端已按本方案实施；Adapter 端尚未修改。实现配置与交接说明见 [agent-bff-implementation.md](./agent-bff-implementation.md)。以下保留两端原定方案。范围：补齐原 T03 的服务间身份信任与对应 T14 验证；不新增独立 BFF 服务，不扩展购物业务。

## 1. 源码结论

核对日期：2026-09-18；Adapter 本次读取的 main tree SHA：`631b9e0bf33f2bcc2e6e21328eb5f84aca52fef2`。

- Storefront 已有 `resolveAgentSessionUser → getHeaderAuthState → 现有 Saleor 服务端会话`，继续复用。
- Adapter `agui/router.py:get_storefront_context()` 只接受 `request.state.storefront_context` 中的 `TrustedStorefrontContext`，否则返回 401。
- `agui/schemas.py` 明确要求可信验证器保护 BFF 来源和 visitor 完整性，不允许从浏览器 JSON 直接构造该对象。
- `app/factory.py:create_app()` 目前没有注册此验证器。`main.py` 仅调用 `create_app()`；默认 `agui_scope=None`，`app/lifespan.py` 因此不会装配 AG-UI runner。仅加入身份请求头仍不足以启动完整链路。
- `persistence/contracts.py:StoreScope` 包含 `tenant_id`、`store_id`。它不是浏览器 frontend state 中的 Saleor channel。
- `agui/runner.py` 已检查 store scope，以及工具回执与原 run 的 visitor、Saleor user、身份状态是否一致；这些检查保留。

源码依据：

- [AG-UI 路由](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/agui/router.py)
- [可信上下文](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/agui/schemas.py)
- [应用工厂](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/app/factory.py)
- [启动装配](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/app/lifespan.py)
- [会话与回执授权](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/agui/runner.py)

## 2. 推荐方案

采用 HTTPS + 服务端 HMAC-SHA256 请求签名。Node 使用 `node:crypto`，Python 使用 `hmac/hashlib`；两端约定同一份版本化协议和测试向量。

请求链路：浏览器同源请求 → Next.js 读取现有 Saleor session 和受保护 visitor Cookie → 序列化 AG-UI 正文并签名 → Adapter 验证签名/时效/正文/重放/scope → 构造 TrustedStorefrontContext → 原有 runner。

签名密钥仅部署在两端服务端。Saleor access/refresh token 不传给 Adapter；Adapter 原有 Saleor service token 不用于此签名。用户身份仍由 Next.js 每次读取现有会话确定。

以下协议名、文件名、环境变量均为拟新增设计，并非 Adapter 已有能力。

### 请求协议

使用一个服务端头：`X-Storefront-Authorization: v1.<kid>.<payload>.<signature>`。

- `kid` 是固定配置中的密钥标识，仅允许有限 ASCII 标识符，不含点或换行。
- `payload` 是 UTF-8 JSON 的无填充 base64url；携带 `iss`、`aud`、`iat`、`exp`、随机 `jti`、`scope`、`identity`。
- `scope` 为服务端固定 `tenant_id/store_id`。
- `identity` 为 `visitor_id/status/saleor_user_id` 白名单；只有 authenticated 才含 Saleor user ID。guest 映射 anonymous，unavailable 保留，不降级为 guest。
- 不加入 approvals；身份认证不等于批准购物车写操作。

签名输入为以下六段，用单个 LF 连接，无末尾 LF：

```text
v1
<kid>
POST
<Adapter 实际接收路径>
<实际 HTTP 正文 UTF-8 字节的 SHA256 小写 hex>
<payload 原始 base64url 字符串>
```

`signature = base64url(HMAC-SHA256(key, UTF8(signingInput)))`。

Next.js 只执行一次 `JSON.stringify(input)`，同一串字节用于摘要和 fetch。Adapter 对收到的原始正文验摘要，不对 JSON 重新序列化。入站路径严格允许 `/api/agent`、`/agui`、`/api/agent/tool-results`，不允许 query；代理若重写路径，必须明确签署 Adapter 实际看到的路径。

建议初始时效为 60 秒、时钟偏差最多 5 秒；验 `exp > iat`、`exp-iat ≤ 60`，拒绝过期和未来时间异常。该时效只用于接收请求，不会在 60 秒时切断已认证的 SSE。每条消息和每个独立工具回执请求重新生成签名与 jti。

Adapter 在验签成功后，以数据库唯一约束原子登记 jti；重复请求拒绝。记录保留到 exp 加时钟宽限后才能清理。网络失败后的业务重试仍由 run/message/call 的幂等策略处理，不能因换了 jti 就自动重新执行 mutation。

### visitor 来源必须一起修正

当前 localStorage visitor ID 由浏览器自报；直接对它签名，只能证明 Next.js 收到过该值，不能证明访客拥有该身份。

新增服务端签名、HttpOnly、Secure（生产）、SameSite=Lax、Path=/、不设 Domain 的 Agent visitor Cookie，采用独立密钥。Cookie 内容含版本、随机 visitor ID、期限、scope、最近已验证身份的绑定信息；Cookie 验签后才可用于身份构造。开发 HTTP 使用明确的非生产 Cookie 配置。

- 首次访问：服务器生成随机 visitor，不能直接认可旧 localStorage ID。
- 登录升级：同一访客 anonymous → authenticated 保留 visitor/thread，让 Adapter 复用现有升级逻辑。
- 退出、切换账号、已登录会话明确失效：轮换 visitor，并让前端新建 thread、取消旧 run。
- Saleor 会话临时 unavailable：保留已有绑定，不误判为退出；由 Adapter 现有 unavailable 策略处理。
- 首次迁移或 Cookie 丢失：生成新 visitor/thread，不自动认领仅凭旧 localStorage ID 指向的历史。
- threadId 仍是关联标识；最终会话所有权由 Adapter 校验，不以知道 threadId 作为访问权限。

## 3. Next.js 端工作

| 文件                                                                | 函数/类                                                                                                  | 作用与大致实现                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增 `src/agent/config/server.ts`                                   | `AgentServerConfig`、`getAgentServerConfig()`                                                            | server-only；读取 Adapter URL、issuer/audience、scope、签名 kid/key、visitor Cookie key。验证 URL、至少 32 随机字节的独立密钥和必需配置；启用时缺配置明确失败。                                                                     |
| 新增 `src/agent/identity/visitor-cookie.ts`                         | `readVerifiedVisitor()`、`issueVisitorCookie()`、`resolveVerifiedVisitor()`、`clearAgentVisitorCookie()` | 校验 Cookie 签名/期限/scope，服务端生成 visitor，根据当前 Saleor session 决定保留/升级/轮换；返回需要设置的 Cookie 和是否必须新建 thread。签名带独立用途标识，与上游请求签名隔离。                                                  |
| 新增 `src/app/api/agent/session/route.ts`                           | `POST()`                                                                                                 | 同源校验后初始化受保护 visitor；响应只提供公开 visitor ID 和 thread-reset 标记，Cookie 通过 Set-Cookie 写入。no-store，不返回用户 ID、令牌或签名。初始化必须完成后才能启动 run。                                                    |
| 修改 `src/agent/agui/adapter-auth.ts`                               | `prepareAdapterRequest()`、`buildSignedClaims()`、`signAdapterRequest()`                                 | 替换当前抛错占位；从已验证 session/Cookie 构造 claims，正文序列化一次，签名后返回服务端固定 URL、白名单 headers、相同 body。丢弃浏览器传入的认证头。                                                                                |
| 修改 `src/agent/agui/server.ts`                                     | `createAgentPost()`、`readAgentRequest()`、`buildTrustedIdentity()`                                      | 不再使用浏览器 visitor 字段作为身份依据；session + 已验证 Cookie 决定可信身份。visitor 提示不匹配或身份轮换时返回明确 409/reset 响应，不执行该业务请求；必要 Cookie 在 SSE headers 发出前写入。继续保留同源、大小、超时和取消检查。 |
| 修改 `src/app/api/agent/route.ts`                                   | `POST` 装配；`runtime`                                                                                   | 使用真实签名器，显式 Node.js runtime。响应仍直接转发 SSE。                                                                                                                                                                          |
| 修改 `src/agent/components/AIProvider.tsx`                          | 初始化 effect、`sendMessage()`、`startNewConversation()`                                                 | 先调用 session 初始化，使用服务器确认的 visitor，再创建 client。visitor 变化先取消旧请求并清理旧 thread；新会话只换 thread。初始化并发需合并，发生 Cookie 不匹配时重新初始化，不自动重放购物车写操作。                              |
| 修改 `src/agent/identity/visitor.ts`、`src/agent/agui/transport.ts` | visitor 保存函数、初始化/409 错误处理                                                                    | localStorage 只保存服务器确认的公开提示，不能提供授权依据。新增稳定错误分类，让 Provider 能区分服务不可用和身份需重置。                                                                                                             |
| 修改 `src/app/actions.ts`、`src/lib/auth/use-logout.ts`             | `logout()`、现有登出后处理                                                                               | 现有登出成功路径同时清理服务端 Agent visitor Cookie 和前端 visitor/thread；不修改 Saleor 密码登录流程。                                                                                                                             |
| 修改 `.env.example`                                                 | 服务端配置说明                                                                                           | 增加下述变量，不含真实密钥，不使用 NEXT_PUBLIC 前缀。                                                                                                                                                                               |

原 `bff-server.ts`、`server.ts`、`bff-client.ts` 的认证主体无需重写。`resolveAgentSessionUser()` 保留为统一会话来源。

拟新增环境变量：`AGENT_ADAPTER_URL`、`AGENT_BFF_ISSUER`、`AGENT_BFF_AUDIENCE`、`AGENT_BFF_KEY_ID`、`AGENT_BFF_SIGNING_SECRET`、`AGENT_TENANT_ID`、`AGENT_STORE_ID`、`AGENT_VISITOR_COOKIE_SECRET`。密钥使用 base64 编码随机字节，双方明确按 base64 解码后使用。

## 4. Adapter 端工作

以下路径除测试/脚本外均以 `src/agent_adapter_service/` 为根。

| 文件                                         | 函数/类                                                                | 作用与大致实现                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增 `security/storefront_bff.py`            | `BffClaims`、`VerifiedBffRequest`、`StorefrontBffVerifier.verify()`    | 严格解析版本/头长度/字段，按已配置 kid 选密钥；验原始 payload 签名、method/path/body 摘要、时间、issuer/audience、密钥允许的 scope、身份字段一致性，使用 constant-time compare。验证成功后原子消费 jti，再创建 StorefrontIdentity/TrustedStorefrontContext，approvals 默认为空。                        |
| 修改 `agui/router.py`                        | `get_storefront_context()`、`read_json()`；新增 `read_request_bytes()` | 推荐在现有 FastAPI dependency 内调用 verifier，成功后写 request.state 并返回 context。这样复用现有异常处理且只保护三个 AG-UI 入口。读取正文有上限，把同一 bytes 缓存在 request.state，read_json 复用，避免验签后下游读到空 body。生产不得仅因预先存在某对象就跳过验签；测试用显式 dependency override。 |
| 新增 `persistence/models/bff_nonce.py`       | `BffNonceRow`                                                          | 保存 issuer、audience、tenant/store、jti、expires_at；以上身份空间和 jti 建唯一约束。加入有效期索引。                                                                                                                                                                                                   |
| 修改 `persistence/models/__init__.py`        | 模型导入                                                               | 把新表注册到现有 SQLAlchemy metadata。                                                                                                                                                                                                                                                                  |
| 新增 `persistence/repositories/bff_nonce.py` | `SqlBffNonceRepository.consume_once()`、`purge_expired()`              | 使用现有 Database.session()；原子插入，唯一冲突表示重放。不是先查询再写入；数据库不可用不能放行。清理只删除超过验证宽限的过期记录。                                                                                                                                                                     |
| 新增 `scripts/migrate_bff_nonce.py`          | `main()`、`apply_migration()`                                          | 仓库目前未提供完整迁移框架，新增受控、可重复的建表迁移脚本，仅创建 nonce 表/索引。开发测试可用现有 create_schema；生产仍保持 database_create_schema=False。                                                                                                                                             |
| 修改 `core/settings.py`                      | `Settings`、`validate_enabled_integrations()`                          | 新增 AG-UI 开关、scope、issuer/audience、kid→secret 配置、时效；使用 SecretStr，禁止日志显示密钥。AG-UI 启用时要求数据库、Parlant、身份验证配置齐全。非敏感 YAML 字段同步白名单，秘密仅环境/secret storage。                                                                                            |
| 修改 `app/factory.py`                        | `create_app()`                                                         | 未显式注入 scope 时，从可信部署配置构造 StoreScope；保留测试依赖注入。不能只定义配置而仍让默认入口保持 agui_scope=None。                                                                                                                                                                                |
| 修改 `app/lifespan.py`                       | `app_lifespan()`                                                       | 数据库就绪后装配 nonce repository/verifier；沿用原 prepare_agui_tools/assemble_agui 顺序；AG-UI 开启时 readiness 检查 verifier/runner/nonce 表可用，关闭时清理资源。                                                                                                                                    |
| 修改 `.env.example`                          | 配置示例                                                               | 说明与 Next.js 对应的 issuer/audience/scope/kid/密钥、数据库和 Parlant 开关。支持 active/previous key 的验证映射，Next.js 只用当前 key 签署。                                                                                                                                                           |

保留现有 `agui/schemas.py:TrustedStorefrontContext`、identity resolver 和 runner 的授权规则。`main.py` 可以继续调用 `create_app()`，由工厂正确读取新配置。

鉴权失败在发送 SSE headers 前返回：无签名/坏签名/过期为 401，合法签名但 scope 不匹配为 403，重复 jti 为 409，请求过大为 413，依赖未就绪为 503。错误不回显密钥、完整 claims、正文或 Saleor token。

## 5. 测试文件与验收

| 文件                                                                           | 主要用例                                                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 新增 Storefront `src/agent/agui/adapter-auth.test.ts`                          | 固定跨语言签名向量；正文中文/换行/顺序变化；URL/path；新消息和回执各自签名；浏览器认证头不能透传。                     |
| 新增 `src/agent/identity/visitor-cookie.test.ts`                               | 伪造 Cookie/visitor、过期、首次迁移、guest→login 保留、logout/账号变化轮换、unavailable 不降级。                       |
| 扩展 `src/app/api/agent/route.test.ts`；新增 session route 测试                | 已登录/匿名/不可用三态；同源和 Cookie 设置；初始化和身份不匹配；SSE 首字节、取消和上游鉴权失败。                       |
| 新增 Adapter `tests/security/test_storefront_bff.py`                           | Node 生成的固定向量在 Python 验证；错误 secret/kid/scope/audience、过期、正文被改、JSON 中伪造身份、三个入口均受保护。 |
| 新增 `tests/persistence/test_bff_nonce.py`                                     | 并发相同 jti 只有一次成功、跨实例共享数据库、过期清理、数据库故障拒绝。                                                |
| 扩展 `tests/agui/test_router.py`、`test_assembly.py`、`tests/test_settings.py` | 验签后才能拿 context；body 可重复使用；原始 create_app() 的配置启动路径能装配 runner；缺少配置明确失败。               |
| 扩展真实联调                                                                   | 匿名对话、登录升级、退出、新访客、他人 thread/回执拒绝、消息流与工具回执身份一致、签名过期不切断已有 SSE。             |

跨语言向量固定 key、时间、jti、payload 字节和正文，双方保存同一 JSON fixture；预期签名提前固定，不能各自调用被测代码生成预期值。

多 worker 部署另需注意：当前 runner 的 active run/dispatcher 保存在进程内。即使 nonce 已共享，工具回执仍必须送到持有原 run 的 worker；首轮真实联调使用一个 Adapter worker。扩大部署前沿用明确的 run 路由策略，不能宣称本次验签补丁解决了运行时横向扩容。

## 6. 实施顺序和边界

1. 固定协议、跨语言测试向量和配置字段。
2. Adapter 实现验证依赖、nonce 持久化与 scope/runner 启动装配。
3. Next.js 实现 visitor Cookie、初始化、签名转发及身份轮换。
4. 通过两端单元/集成测试；Storefront 执行 verify；再用真实服务完成对话和回执联调。
5. 验收后启用 Storefront AI 开关。

本方案解决“Adapter 信任哪个 BFF、哪个访客和用户、哪个店铺”的问题。现有 FrontendConfirmationVerifier 的一次性写操作审批属于原计划的另一项未完成接入；本次不因为 BFF 身份正确就设置 confirmed=True，也不放宽其策略。完成此方案后，可以验收身份与普通对话/自动工具链路，但不能据此把购物车写操作审批标记为完成。
