# AI assistant implementation progress

## 最新补齐：Next.js BFF 签名与 visitor 会话

本仓库现已实现原 T03 的 Next.js 部分：服务端配置与 HMAC 请求签名、HttpOnly visitor Cookie、`/api/agent/session` 初始化、身份变化 409 重置、前端取消与重新初始化，以及 logout Cookie 清理。已有 Saleor BFF session 继续复用。

`adapter-auth.ts` 已替换为实际签名实现。Adapter 仓库尚未修改，仍需实现对应验签与启动装配；没有把本地验证视为真实联调通过。配置、协议、文件入口和测试向量见 [BFF 实现与交接说明](./agent-bff-implementation.md)。

本轮验证：完整 `pnpm run verify` 通过（136 个文件、946 项测试；lint 0 errors、25 条原有 warnings）；独立浏览器测试 3 项通过。未修改远程 Adapter，未配置真实密钥或启用 AI 功能。

## 前一轮状态（2026-09-18）

以下是当前交付状态。后面的 Batch 1–4 保留为历史记录，其中“尚未挂载”“尚未实现”描述的是当时状态。

| 原任务  | 当前实现                                                                                     | 尚未完成的验收条件                                                           |
| ------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| T01/T02 | 配置、visitor/thread 持久化、新会话；成功退出登录后清理身份                                  | 真实登录/退出链路联调                                                        |
| T03     | Session resolver、同源校验、请求大小/协议校验、身份字段隔离、SSE 代理、超时/取消             | `adapter-auth.ts` 需要对接实际 BFF 身份验证器；当前明确返回不可用            |
| T04/T05 | 官方 AG-UI SDK 流解析、Client/Transport、Provider、流式消息、取消、错误、新会话              | 真实 Adapter 会话验证                                                        |
| T06/T07 | 语义状态采集、Provider/Hook、差异计算、版本、后端字段映射；请求和工具回执携带状态            | 后端没有独立状态推送接口；当前不承诺无消息时实时推送，也未验证跨标签并发版本 |
| T08     | PDP 商品/Variant Bridge，按商品生命周期注册和清理                                            | 真实商品切换验收                                                             |
| T09     | 工具参数聚合、校验、串行执行、调用去重、取消/超时、回执与状态关联                            | 部署后的完整工具回路                                                         |
| T10     | navigate、go_back、scroll_to、highlight_element、show_notification；商品/变体/购物车绑定     | 当前 Adapter 不支持 go_back/show_notification，未向它声明这两个工具          |
| T11     | 商品查询/选择变体、筛选回调、购物车 Server Actions、打开购物车、checkout session-bridge 跳转 | Adapter 不支持 set_product_filters；购物车写操作的后端前置审批验证器尚未提供 |
| T12     | 对话面板、Markdown、输入/停止、消息列表、工具状态与确认/拒绝、多语言                         | 真实服务验收                                                                 |
| T13     | 通过 StorefrontProviders 按功能开关挂载，不绕过现有 Cart/Catalog Provider                    | 开关默认关闭，待 T03 真实验证器接通后启用                                    |
| T14     | 单元、组件、路由、协议和独立浏览器测试已补齐，验证结果见下节                                 | 真实 Saleor + Adapter + BFF 联调尚未完成                                     |

### 实现约定与源码差异

- 浏览器只访问同源 `/api/agent`。服务端解析 Saleor 会话，浏览器不能通过 `storefrontIdentity` 或请求头声明可信用户。visitor ID 本身仍是不可信提示，需要部署验证器绑定其所有权。
- `src/agent/agui/adapter-auth.ts` 是明确未完成的部署接入点，不是假实现成功。源码仓库地址无法替代可运行 API 地址或验证器约定；本轮没有新增后端改造项目。
- 当前 Adapter 仅接受 `forwardedProps.toolResults`。回执通过同一 AG-UI 路由、空 messages/state 提交，并关联原 thread/run/call。状态随成功回执发送；失败回执使用 `status: error`，不附带状态或 resulting_state_version。
- 前端确认按钮绑定实际工具调用，商品/变体摘要由 Saleor 查询得到。拒绝、超时或取消不执行后续 mutation。它不替代 Adapter 在发送写工具前要求的可信审批验证器。
- 商品、变体和购物车操作复用现有 GraphQL/Server Action 和购物车上下文；数量真正传给 Saleor，业务 errors 不会被当成成功。checkout ID 留在受控闭包或 Cookie 中，不进入共享 Agent 状态。
- `open_checkout` 只进入现有 checkout 页面，在回执成功后执行跳转，不提交订单或付款。独立 checkout surface 没有额外挂载助手。
- 状态在本地按语义变化更新；网络发送使用 Adapter 接受的版本化快照，避免将本地差异对象直接当作协议数据。失败不表示状态已被服务器确认。
- `go_back`、`show_notification`、`set_product_filters` 保留原计划的本地实现，但不向尚不支持它们的 Adapter 宣告可用。

### 复现验证

主要代码入口：

- T03：`src/app/api/agent/route.ts` 装配 POST；`src/agent/agui/server.ts` 的 `createAgentPost`、`readAgentRequest`、`buildTrustedIdentity` 负责可注入、可测试的请求处理；`adapter-auth.ts` 保留真实验证器接入点。
- T04/T05：`agui/client.ts` 的 `AgentClient` 管理请求/流/回执，`transport.ts` 的 `AgentTransport` 管理 HTTP；`components/AIProvider.tsx` 管理消息、会话与确认生命周期。
- T07/T08：`state/provider.tsx` 的 `AgentStateProvider` 聚合状态；`product-state-bridge.tsx`、`product-actions-bridge.tsx`、`cart-state-bridge.tsx` 连接实际页面数据；`wait-for-state.ts` 等待商品/变体切换落地。
- T09–T11：`hooks/useAgentTool.ts` 连接 SDK 调用与执行器；`tools/bindings.ts` 保存受控页面动作；`tools/product.ts`、`cart.ts`、`checkout.ts`、`navigation.ts`、`ui.ts` 定义工具；`state/storefront-actions-bridge.tsx` 接现有页面和 Server Actions。
- T11：`src/app/actions.ts` 的 `resolveAgentProductRoute`、`resolveAgentVariant`、`describeAgentCartAction`、`addCartLine`、`mutateAgentCart` 复用 Saleor 查询和购物车操作；PDP 原添加按钮也调用共享 `addCartLine`。
- T12/T13：`src/agent/components/AI*.tsx`、`src/ui/components/storefront-providers.tsx`、八种现有语言的 `messages/*.json`；功能开关见 `.env.example`。
- T14：`src/agent/**/*.test.ts(x)`、`src/app/api/agent/route.test.ts`、`e2e/agent.spec.ts` 和独立 `playwright.agent.config.ts`。

```powershell
# 使用实际 Saleor 3.23+ GraphQL 地址；离线检查也可临时指向该版本官方 schema.graphql。
$env:NEXT_PUBLIC_SALEOR_API_URL = '<Saleor URL 或本地官方 SDL 路径>'
pnpm run verify

# 真实 React 组件 + 官方 AG-UI SDK + 模拟 SSE 的独立浏览器测试。
pnpm exec playwright install chromium
pnpm exec playwright test --config playwright.agent.config.ts
```

浏览器 fixture 位于 `e2e/agent-harness/`，只用于测试，未增加产品路由；它不经过真实 BFF 验证器，也不调用真实 Saleor。标准 Playwright 配置排除此独立 fixture 测试。

本轮最终检查结果：

- `pnpm run verify`：通过。包含文档一致性、设计 token、废弃 variants 检查、两套 GraphQL 生成、全仓库 TypeScript、ESLint 和 131 个文件的 918 项测试。Lint 为 0 errors、25 warnings；未为通过检查而禁用规则或跳过测试。
- Schema 使用 Saleor 官方 `3.23` 分支的 `saleor/graphql/schema.graphql` 本地副本；它证明静态接口兼容，不代表连接过真实实例。该路径只用于本轮命令环境，没有写入运行时配置。
- 独立 Playwright：2 项通过，覆盖流式文本、打开购物车与回执、新会话保留 visitor、移动端边界、Escape 关闭及焦点恢复。已查看 `test-results/agent-mobile.png`；fixture 使用现有 token 样式，未加载真实站点的 Next 字体。
- 启用 AI 后执行 `pnpm exec next build`：编译和 TypeScript 通过；预渲染 `/en/default-channel/products` 时因无法连接 Saleor 而失败。使用明确不可用的本地占位 API 地址，没有以假商品数据掩盖失败。完整生产构建和 PPR 验收仍未通过。
- `git diff --check`：通过。
- 为使 Windows 上的原有验证可运行，修复了 CRLF 文档/快照比较、CLI shebang 的 LF 固定，以及 ESLint 排除本地 `.pnpm-store` 缓存；没有增加业务需求。

交付结论：前端运行时、页面桥接、工具执行和聊天 UI 已落地并通过上述本地检查；T03 部署身份验证接入及 T14 真实联调未完成，部分工具仍受 Adapter 当前接口支持范围限制。功能开关继续默认关闭，不能把这些测试结果视为可直接上线的证明。

## 历史实施记录

## Batch 1

- T01: public configuration and Storefront extension types implemented.
- T02: visitor/thread generation, persistence, explicit clearing and new conversation implemented.
- T03: server-only `resolveAgentSessionUser` implemented. BFF proxy pending the adapter verification contract below.
- T04–T14: not implemented in this batch. No chat UI or network transport is mounted.

`NEXT_PUBLIC_AI_ASSISTANT_ENABLED` defaults to false and is enabled only by the literal `true`.
It is a build-time public flag. The future browser endpoint is `/api/agent`.
Do not put adapter URLs or credentials in public configuration.

Call browser persistence helpers after client mount. Server reads return null; server writes
throw to avoid sharing visitor state between requests. IDs use separate versioned localStorage
keys, contain only a prefix and a random UUID, and are untrusted browser hints. Corrupt IDs are
replaced. When storage is blocked/full, IDs remain stable in memory for the current page only;
reload persistence cannot be promised in that mode. Starting a conversation changes only the thread.

The session resolver reuses Paper's BFF auth classification, preserves guest/authenticated/unavailable,
and projects only the Saleor user ID. It is deliberately excluded from the browser-safe barrel export.

## Batch 2

- T06 implemented: semantic state types, route classification and a pure allowlisted collector.
- T07 partially implemented: section diffing and local revision tracking. React provider/hook and
  live synchronization remain pending T04/T05; the synchronizer does not send network requests.
- Added an adapter state projection based on its actual strict schema. This is a project-specific
  state payload conversion, not a replacement for the official AG-UI protocol.

The collector uses Paper's locale/channel path parser and catalog identity. It recognizes the
separate `/checkout` surface, strips all query/hash values, redacts guest order access keys and
account order numbers, and rejects malformed/ambiguous paths. Product state is cleared when
leaving a PDP or when the supplied product no longer matches the current slug/translation.
Checkout steps are cleared outside checkout. Unknown cart counts stay absent in local state.
Auth hints preserve guest/authenticated/unavailable/unknown and never contain a user ID.

`AgentCartState` deliberately omits the plan's optional `checkoutId`: Paper uses that value as
a bearer-like checkout reference, so it must not be sent as general Agent context.
The collector copies only selected fields, bounds strings/counts/attributes, and never copies
entire cart, session or catalog objects. Custom attribute values remain UI hints supplied by
the future PDP bridge; this is not a general-purpose redactor of arbitrary user text.

The synchronizer emits an initial snapshot, then section replacements for real changes only.
It owns consecutive revisions and ignores input-only version changes. Reset with the authoritative
server revision on reconnect/retry; reset to zero for a new conversation. A returned payload is
locally emitted state, **not** proof of delivery. The future transport must serialize sends and
reconcile failures before advancing remote state. Input/output mutation cannot change its baseline.

### Actual adapter state contract

Reviewed [`frontend/state/models.py`](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/frontend/state/models.py)
and [`reducer.py`](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/frontend/state/reducer.py):

- Wire keys use snake_case (`page_type`, `variant_id`, `item_count`, `is_logged_in`).
- Collection/account remain distinct locally; their adapter page type is `other`.
- Product wire state contains only ID, variant ID, color and size. Names, slugs, SKU and other
  attributes are local-only until the backend model explicitly supports them.
- `unavailable` and `unknown` map to a null login hint, never false. This hint does not authorize access.
- The current adapter has no unknown cart-count representation: conversion uses its zero default.
  Its context builder excludes default values; consumers must not infer an authoritative empty cart.
- Deltas require `base_version`, `version = base_version + 1`, and `changes`. Changed sections
  contain all accepted leaves, including null/false/zero, so the backend's leaf merge clears
  departed product/variant/checkout state. Local `StateSyncPayload` must not be sent as wire JSON.
- Timestamp `updated_at` stays server-owned. No UI/schema changes were made to the remote repository.

Use `toAdapterFrontendState` for a snapshot and `toAdapterFrontendStateDelta(previous, current)`
for a delta. A local-only change can yield empty wire `changes`; that revision still needs delivery
to keep subsequent base versions aligned. No adapter connection or browser UI is mounted yet.

## Batch 3

- T09 core implemented: tool types, registry and executor. `useAgentTool` remains pending the
  React runtime and state provider; there is no mounted browser tool handler yet.
- T10 partially implemented: `createNavigateTool` with strict path arguments and current-market
  browse routing. UI targeting/highlighting/notifications are not implemented in this batch.

The registry rejects duplicate/invalid names and captures frozen definitions. The executor
checks policy before parsing, clones arguments and state, limits execution time, propagates
cancellation with AbortSignal, and handles late settlement without unhandled rejections.
Tools must observe the signal before side effects and after awaits. Timeout/cancellation does
not roll back completed actions or forcibly stop implementations that ignore the signal.
The future runtime must cancel on unmount, navigation/identity boundaries and new conversation,
and handle AG-UI call IDs/deduplication; this low-level executor has no delivery/replay state.

Policy uses registered metadata and fixed minimum restrictions. Requested risk can strengthen
but never weaken the local policy. Payment/order submission/account deletion are denied;
add-to-cart, removal and quantity changes require confirmation even if registered as automatic.
Confirmation-class tools currently return `confirmation_required` without executing. There is
no `confirmed` argument bypass. A real user interaction and the adapter's call-bound approval
mechanism must be implemented before enabling these actions.

Tool results are local discriminated success/failure values. Success receipts expose only
applied/productId/variantId/itemCount; arbitrary tool data, exception messages and stack traces
are not returned. The eventual AG-UI bridge must map these to the adapter's call_id/status and
snake_case receipt schema, correlate the resulting state revision, and send tool results once.

### Navigation contract and boundaries

The adapter's [`frontend/tools/policy.py`](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/frontend/tools/policy.py)
accepts `navigate` with `{ pathname }`, not the plan's example `{ href }`. The implementation
uses that actual argument shape and rejects extra keys, external/script URLs, queries/fragments,
encoded paths, traversal, control characters and repeated slashes. It accepts only known browse
routes in the current locale/channel, uses Paper's path builder, and requests `router.push`.
The returned receipt confirms that navigation was requested, not that the destination loaded.

The generic tool cannot switch markets or cross auth/checkout surfaces. Checkout needs the
existing session-bridge handoff through a dedicated future tool. `go_back` is not registered:
the current adapter does not support it, and arbitrary browser history may leave the storefront.
Likewise, backend UI targets are product/variants/cart/checkout; future UI bindings must map those
to explicit safe elements rather than accepting selectors from an Agent.

Batch 3 checks:

- 131 Agent tests passed across 8 files (55 tool tests added).
- Isolated typecheck passed for 22 Agent files including tests; the session resolver and its
  test remain excluded from this typecheck because generated Saleor types are unavailable.
- Agent ESLint passed using the example API URL solely for configuration loading, as in Batch 2.
- `verify` passes docs, design-token and deprecated-GraphQL checks, then stops at codegen because
  `NEXT_PUBLIC_SALEOR_API_URL` is unset. No GraphQL documents, layouts or runtime mounts changed.

## Batch 4

- T10 UI tool core implemented: `scroll_to` and `highlight_element`.
- Added `FrontendTargetRegistry` for explicit product/variants/cart/checkout element bindings.
- Runtime/React bridge registration, browser visual verification and notification UI remain pending.
  The current adapter does not declare `show_notification`, so no unsupported wire tool was added.

Targets are registered by trusted page code, never discovered using an Agent-provided selector.
The registry rejects unknown names and ignores disconnected/no-layout elements, hidden/inert/
aria-hidden regions and elements with hidden/collapsed visibility or display:none. Operations also
check page semantics: product/variant regions require a PDP, checkout requires its surface, and
cart targets require the cart page or an open drawer. Bind only the active visible instance when
desktop/mobile render separate copies of a region.

Each registration returns a cleanup function. Replacement and cleanup abort pending operations;
stale cleanup cannot delete the replacement binding. The future runtime must call `clear()` when
unmounting/resetting and bridges must unregister on navigation or element removal. No DOM/window
access occurs at module import time.

```ts
const targets = new FrontendTargetRegistry();
registry.register(createScrollToTool(targets));
registry.register(createHighlightElementTool(targets));
// Inside a future mounted page bridge, after its element exists:
const unregister = targets.register("variants", element);
// Bridge cleanup:
unregister();
```

Scrolling is instant, requests center/nearest alignment, and does not change focus. Highlighting
uses existing ring/background tokens for a locally configured 1.5 seconds by default (maximum
5 seconds). The Agent cannot supply duration, selectors or HTML. Completion, cancellation, timeout,
registration removal and replacement release the effect and its timers/listeners. Overlapping
highlights use reference-counted ownership so one request cannot prematurely clear another;
classes present before the first highlight are retained. The highlighted element's className must
remain owned by its page component; actual React rerender/visual behavior needs browser verification
when bridges are mounted.

The highlight tool resolves after its temporary effect finishes, keeping the executor's cancellation
signal connected for its lifetime. A detached target without bridge cleanup is detected at completion;
proper bridge cleanup removes the effect immediately. A missing/unavailable region returns the stable
local `target_not_found` result for later AG-UI result mapping.

Batch 4 checks:

- 158 Agent tests passed across 9 files (27 UI target/lifecycle tests added).
- Isolated typecheck passed for 25 Agent files; session resolver files remain excluded as before.
- Agent ESLint passed; the example Saleor URL was used only to load lint configuration.
- Tests use a DOM interface fixture; no claim of mounted-browser visual or end-to-end verification.
- Full `verify` again passes docs/design-token/deprecated-GraphQL checks and stops at codegen
  because `NEXT_PUBLIC_SALEOR_API_URL` is unset. No page/layout/GraphQL changes were made.

## Adapter contract findings

Reviewed the supplied repository's main branch on 2026-09-17:

- [`agui/router.py`](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/agui/router.py)
  exposes `POST /api/agent` (SSE), alias `/agui`, and `POST /api/agent/tool-results`.
  It requires `request.state.storefront_context` to be a verified `TrustedStorefrontContext`.
- [`agui/schemas.py`](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/agui/schemas.py)
  explicitly forbids constructing trusted context from request JSON. The verifier must authenticate
  the BFF, protect visitor integrity, and enforce cookie-session CSRF/origin checks.
  `forwardedProps` accepts `toolResults` only, with extra fields forbidden.
- [`app/factory.py`](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/app/factory.py)
  mounts the AG-UI router but does not register a BFF identity verifier. No wire-level signing/auth
  contract is specified there. Adding a `storefrontIdentity` JSON field alone cannot authenticate requests.
- [`customer_identity/models.py`](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/customer_identity/models.py)
  uses `anonymous` for Paper's `guest`; the mapping belongs at the verified server boundary.
- [`customer_identity/resolver.py`](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/customer_identity/resolver.py)
  returns `visitor_rotation_required` when a previously authenticated visitor becomes anonymous.
  Preserve the conversation on guest-to-login upgrade, but handle logout/account switching as a
  separate identity boundary when implementing the runtime. T02 provides clearing primitives only;
  it does not yet wire these transitions into auth UI.

## Next batch prerequisites and sequence

1. Agree on or obtain the adapter's verified BFF protocol: authentication/signature format,
   store scope, replay protection, and visitor integrity/ownership binding. A browser-chosen visitor
   ID must not grant access to another visitor's history. Implement/deploy the matching adapter verifier.
2. Complete T03 with origin checks, bounded and validated AG-UI input, server-resolved identity,
   request cancellation/timeouts, and an unbuffered response stream. Test spoofed identity rejection,
   all three auth states, upstream failures, cancellation, and streaming before connecting the UI.
3. T04/T05: use the official AG-UI SDK, then implement the client/runtime and identity transitions.
4. T06–T13: semantic state, existing PDP/cart bridges, policy-controlled tools, chat UI and integration.
5. T14: end-to-end verification against a configured Saleor instance and adapter.

## Verification

Focused coverage is in `src/agent/identity/browser-identity.test.ts` and `session-user.test.ts`.
Run `pnpm exec vitest run src/agent` and the required repository gate `pnpm run verify`.
Full verification requires installed dependencies and `NEXT_PUBLIC_SALEOR_API_URL` pointing at a
compatible Saleor schema, since typecheck regenerates both GraphQL clients and lint loads the schema.

Batch 1 checks (2026-09-17):

- Focused Vitest: 12 tests passed across 2 files.
- Isolated TypeScript check for the 7 T01/T02 source files: passed, with Node types explicitly
  included. This excludes the session resolver, whose imports require generated Saleor types.
- ESLint on `src/agent`: passed. Only TypeScript files were selected; the example Saleor URL
  satisfied the lint config's environment guard without validating a live GraphQL schema.
- Prettier, design token check, deprecated product-variants check and `git diff --check`: passed.
- `pnpm run verify`: blocked by an existing docs-check failure: no authored description mapping
  for `paper-vercel-cost.md`. The compiled skill document also has existing drift.
- `pnpm run typecheck`: blocked in its codegen prehook because `NEXT_PUBLIC_SALEOR_API_URL`
  is not configured. Full repository typecheck/build and live adapter integration remain unverified.

Dependencies were installed from the unchanged lockfile. On a machine without a global pnpm shim,
the session used the workspace-local Corepack cache and shims under ignored `.pnpm-store/`.

Batch 2 checks:

- Agent Vitest: 76 tests passed across 5 files (64 state tests added).
- Agent ESLint and formatting checks passed. ESLint used the example Saleor URL only to satisfy
  configuration loading; no live GraphQL schema was checked. `git diff --check` passed.
- Isolated TypeScript check: 15 Agent files including tests passed; session resolver files are
  excluded because their imports require generated Saleor types. Node types were explicitly included.
- The apparent Batch 1 docs drift was traced to Windows CRLF handling. The frontmatter checker
  now recognizes LF/CRLF, and the compiler normalizes line endings for comparison. Both checks pass
  without rewriting the compiled skill document or changing any authored rules.
- Full `verify` now proceeds through docs/design-token/deprecated-GraphQL checks; GraphQL codegen
  still requires a configured `NEXT_PUBLIC_SALEOR_API_URL`. Live adapter integration remains pending
  the same verified BFF protocol prerequisite as Batch 1.
