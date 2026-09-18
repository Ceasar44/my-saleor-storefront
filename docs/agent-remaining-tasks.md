# Storefront AI / AG-UI 剩余工作任务计划

整理日期：2026-09-17。

依据：用户提供的《storefront*代码生成计划.md》《storefront_AI改造*项目背景与架构说明.md》、当前 storefront 工作区及 agent_adapter_service 源码。

本文件保留原定实施计划，文中“新增”“修改”描述计划要求，不代表最新完成状态。2026-09-18 已继续实施；逐任务进展、实际文件组织、验证结果与外部阻塞见 [agent-integration.md](./agent-integration.md)。沿用原计划 T01–T14，不增加新的业务目标或后端改造项目。函数名为拟定的项目接口；AG-UI 协议类型和 SDK 方法以实际安装版本为准，不另造协议。

## 一、范围与任务顺序

### 不重复生成的已完成工作

| 原任务         | 当前成果                                                  | 后续处理                                          |
| -------------- | --------------------------------------------------------- | ------------------------------------------------- |
| T01            | config/agent.ts、agui/types.ts、index.ts 的基础配置和类型 | 复用；在 T04/T05 中补充实际用到的导出和 UI 类型   |
| T02            | visitor、thread、storage 及 browser-storage               | 复用；T05 负责接入生命周期                        |
| T06            | state/types.ts、collector.ts                              | 复用；状态数据来源在 T07/T08 中接入               |
| T07 已完成部分 | synchronizer.ts、adapter.ts                               | 复用本地差异计算和后端格式转换                    |
| T09 已完成部分 | tools/types.ts、registry.ts、executor.ts                  | 复用；只补工具桥接和原计划 confirm 风险的执行闭环 |
| T10 已完成部分 | navigate、scroll_to、highlight_element、targets.ts        | 复用；补剩余工具与实际元素绑定                    |
| T14 已完成部分 | 9 个 Agent 测试文件，158 个测试                           | 保留；补缺失的集成与 UI/E2E 测试                  |

### 剩余任务

| 编号 | 剩余工作                               | 依赖                           |
| ---- | -------------------------------------- | ------------------------------ |
| T03  | 完成可信身份 BFF Route                 | T01/T02，已有 session resolver |
| T04  | AG-UI Client、Transport、Event helpers | T03                            |
| T05  | Agent Provider 与 Conversation Runtime | T04                            |
| T07  | State Provider、Hook 与同步接入        | T05、已有 T06                  |
| T08  | Product / Variant 状态桥接             | T07                            |
| T09  | Tool Hook、调用与结果回传              | T05、T07、已有工具框架         |
| T10  | Navigation / UI 工具补齐与绑定         | T09                            |
| T11  | Product / Cart / Checkout 工具         | T08、T09                       |
| T12  | Chat UI Components                     | T05；状态与工具展示接 T07/T09  |
| T13  | Storefront 全局挂载                    | T07–T12                        |
| T14  | 补齐测试与主链路验收                   | 随各任务补测，T13 后整体验收   |

建议执行顺序：T03 → T04 → T05 → T07 → T08 → T09 → T10 → T11 → T12 → T13 → T14。T12 可在 T05 后用 mock 独立开发；这只是原任务的执行安排。

### 实现边界

- 保持原计划的浏览器 → Storefront BFF → Adapter 通信方式。
- 复用现有商品、Variant、购物车和认证机制；Agent State 只保存语义投影。
- 保持 browse layout 同步，鉴权放在 BFF 请求中。
- 原计划的 go_back、show_notification、set_product_filters 保留，不因后端暂未支持而删除。
- 后端接口缺口仅记为对应任务的联调条件，不在本计划中新增后端开发任务，也不将其伪装成已解决。
- 不纳入新需求：会话列表、历史搜索、文件上传、语音、推荐卡片、管理后台、分析看板、自动支付。Citation / Rich Content 仍是原计划的后续扩展。

## 二、T03 — 完成 Server-side Session User 与 AG-UI BFF Route

### 1. 文件

| 操作 | 文件                                                     |
| ---- | -------------------------------------------------------- |
| 新增 | src/app/api/agent/route.ts                               |
| 复用 | src/agent/identity/session-user.ts                       |
| 修改 | .env.example：记录服务端 Adapter URL；真实凭据不写入示例 |

本任务不新建类。身份解析函数已经存在，不重复生成。

### 2. route.ts 中的函数

#### POST(request: Request): Promise<Response>

作用：浏览器唯一的 Agent 请求入口。

大致实现：校验请求 → 读取 AG-UI 输入与 visitor 提示 → 解析服务端 Saleor 会话 → 构建可信上游请求 → 返回上游流。使用现有 auth 路由的适用请求来源校验方式。错误返回明确状态，不把 unavailable 降级为 guest，不将内部异常或凭据发给浏览器。

#### readAgentRequest(request: Request)

作用：读取并校验允许转发的输入。

大致实现：接受 threadId、runId、messages、state、tools 及已对齐的 AG-UI 字段；visitorId 是独立的不可信浏览器提示。消息和事件类型复用 SDK。移除/拒绝客户端声明的 saleorUserId、customerId、parlantCustomerId、storefrontIdentity，不将浏览器提交的整个对象原样转发。visitor 提示进入 BFF 的位置在 T03/T04 中保持一致，不强塞进后端严格限定的 forwardedProps。

#### buildTrustedIdentity(visitorId, sessionUser)

作用：将已解析会话投影为 Adapter 需要的最小身份信息。

大致实现：guest 映射后端 anonymous；authenticated 带真实 Saleor user ID；unavailable 保留状态。visitorId 不被当作会话所有权证明。不包含 accessToken、refreshToken 或支付信息。

#### forwardAgentRequest(input, identity, signal): Promise<Response>

作用：向服务端配置的 Adapter 转发请求并保持流式响应。

大致实现：调用服务端 URL，应用双方实际存在的 BFF 验证方式，传入取消信号和原 T01 超时配置。响应使用 `new Response(upstream.body, ...)`，保留必要 SSE 响应头，不调用 upstream.text()/json() 消费成功流。取消、超时、上游错误统一处理；清理逻辑覆盖整个流生命周期。

### 3. session-user.ts

复用 `resolveAgentSessionUser()` 和 `AgentSessionUser`，不改变其三态语义、server-only 标记和最小用户字段。除非路由接入确有类型问题，否则不修改。

### 4. 原任务的联调条件

后端要求由验证边界创建的 `TrustedStorefrontContext`，不能直接反序列化浏览器 JSON。当前应用工厂没有接入对应验证中间件，因此不能声称只添加 storefrontIdentity 即完成真实联调。本任务可完成请求整理、会话解析、流式代理及 mock 验证；真实身份通路在后端提供匹配验证入口后验收。本计划不自行指定新的签名系统、凭据服务或后端文件。

### 5. 完成判定

guest/authenticated/unavailable 正确；伪造用户 ID 无效；上游内容增量到达；取消可中断请求。真实 Adapter 验证入口未具备时，任务标注“代码完成、联调待完成”，不能标为整体验收完成。

## 三、T04 — AG-UI Client 与 Transport

### 1. 文件

| 操作 | 文件                                                       |
| ---- | ---------------------------------------------------------- |
| 新增 | src/agent/agui/transport.ts                                |
| 新增 | src/agent/agui/client.ts                                   |
| 新增 | src/agent/agui/events.ts                                   |
| 修改 | src/agent/agui/types.ts、src/agent/index.ts                |
| 修改 | package.json、pnpm-lock.yaml：增加实际使用的官方 AG-UI SDK |

### 2. transport.ts

#### AgentTransportOptions 类型

记录 endpoint；超时默认复用 agentConfig，不再增加另一份配置中心。

#### AgentTransport 类

- `constructor(options)`：保存同源 BFF 地址，只允许浏览器连接 Storefront BFF。
- `run(input, signal?): Promise<Response>`：发送官方 RunAgentInput 对应请求，附带 T03 接受的 visitor 提示，设置 JSON 与 SSE 请求头，处理 HTTP 失败和取消；保留响应流。

如果 SDK 已经提供等价 transport，则本类只做配置包装，或用同名工厂替代；不复制 SDK 的 SSE 解析器。

### 3. client.ts

#### createAgentClient(options): AgentClient

options 包含 threadId、visitorId。作用：创建单个会话的客户端实例，封装官方 SDK、AgentTransport 和项目扩展。

#### AgentClient 项目包装接口

这是对官方客户端的接口约束，不另造 Agent 协议；可通过工厂闭包实现，无需再写一个同名类。

| 方法                             | 作用                     | 大致实现                                                                                              |
| -------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| run(input)                       | 开始一次用户请求         | 生成 runId，读取当前 thread、state、tool 声明，发送稳定 message ID；消费官方事件                      |
| cancelRun()                      | 取消当前请求             | 调用 SDK 取消能力或关联 AbortController；清理订阅                                                     |
| subscribe(listener)              | 让 Provider 接收事件     | 将官方 SDK 事件交给监听器，返回取消订阅函数                                                           |
| setFrontendState(state)          | 更新下次发送的页面状态   | 只更新当前语义状态引用；不因每次 render 自动生成用户对话                                              |
| setFrontendTools(tools)          | 更新当前可用工具声明     | 只声明本地已注册、当前页面可用且后端支持的工具                                                        |
| submitToolResult(result, state?) | 回传工具结果和执行后状态 | 使用后端已有 forwardedProps.toolResults 分支，经同一个 /api/agent 发送；保持原 threadId/runId/call_id |
| dispose()                        | 释放会话资源             | 取消请求、撤销订阅、清理临时引用                                                                      |

工具回执请求与普通用户请求分开组装：后端回执分支要求顶层不同时携带 messages/state；执行后 state 放入对应工具回执条目。由此复用原计划的 /api/agent，不新增业务路由。

### 4. events.ts

生成原计划的五个 helper：

- `isTextMessageEvent(event)`：用官方事件枚举/类型识别文本开始、内容增量、结束。
- `isToolCallEvent(event)`：识别工具调用开始、参数增量、结束。
- `isRunStartedEvent(event)`：识别 Run 开始。
- `isRunFinishedEvent(event)`：识别 Run 正常结束。
- `isRunErrorEvent(event)`：识别 Run 错误。

helper 使用官方协议类型，不接受仅凭字段名猜测的任意对象。

### 5. types.ts / index.ts

types.ts 仅补项目包装接口需要的类型并引用/导出官方类型；index.ts 导出浏览器安全的客户端入口。server-only 身份解析器继续不进入浏览器 barrel。

### 6. 完成判定

mock SSE 与真实可用 Adapter 均能增量接收事件；可取消；HTTP 失败能转换为可处理错误。工具回执字段符合后端，不将本地 StateSyncPayload 直接当作 wire JSON。

## 四、T05 — Agent Provider 与 Conversation Runtime

### 1. 文件

新增：

- src/agent/components/AIProvider.tsx
- src/agent/hooks/useAgent.ts
- src/agent/hooks/useAgentThread.ts

修改：src/agent/agui/types.ts，补 UI 视图模型；src/agent/index.ts，导出组件和 Hook。

### 2. AIProvider.tsx

#### AgentContext / AgentContextValue

提供 client、threadId、visitorId、status、messages、toolStatus、error，以及下面的操作。Context 在组件实例范围内管理会话，不使用服务端模块全局变量保存用户数据。

#### AIProvider({ children })

作用：为当前浏览器页面树提供会话运行时。

大致实现：初始 render 使用稳定空状态；mount 后调用现有 getOrCreateVisitorId/getOrCreateThreadId，创建客户端并订阅事件。通过 ref 保存当前 client/run 标识，丢弃已取消或旧会话的迟到事件。unmount 取消并释放客户端。

#### sendMessage(text): Promise<void>

作用：提交用户输入。

大致实现：过滤空白、校验最大长度；为用户消息生成稳定 ID，加入显示列表；调用 client.run；同一会话有活动 Run 时按原 UI 禁止重复发送。请求不读取 Saleor token。

#### cancelRun(): void

作用：终止当前 Run。

大致实现：取消客户端请求和本次待执行工具，清理 loading 状态，保留已经收到的内容；不把用户主动取消显示为服务故障。

#### startNewConversation(): void

作用：保留 visitor、新建 thread。

大致实现：先停止旧 Run，再调用现有 startNewThread，清空当前聊天视图/工具状态/错误，释放旧 client 并创建新 client。通知 T07 重置该 thread 的同步基线。

#### handleAgentEvent(event): void

作用：将官方事件归并为 UI 状态。

大致实现：按照 messageId 拼接文本，按照 toolCallId 汇总参数和工具状态；完整调用交给 T09 注册的 handler；Run Started/Finished/Error 更新运行状态。参数流未结束前不执行工具。

#### setToolCallHandler(handler): () => void

作用：允许内层 T09 工具桥接接收调用。

大致实现：保存当前执行回调，返回撤销函数；AIProvider 自身不调用内层 AgentStateProvider 的 Hook，避免 Provider 顺序形成循环依赖。

### 3. useAgent.ts

`useAgent(): AgentContextValue`：读取 AgentContext；不在 Provider 中时抛清晰错误。UI 不直接创建客户端。

### 4. useAgentThread.ts

`useAgentThread()`：通过 useAgent 仅暴露 threadId、startNewConversation；避免新会话按钮依赖整个运行时。

### 5. 补充类型

- `AgentConnectionStatus`：初始化、空闲、运行、失败等 UI 状态。
- `AgentChatMessage`：message ID、角色、内容、流式状态；不复制 AG-UI 全协议。
- `AgentToolStatus`：当前调用 ID、名称、执行状态和安全结果摘要。

### 6. 完成判定与边界

刷新恢复 visitor/thread；新会话只改 thread；卸载和取消可中止 Run；匿名转登录保持原 thread。原计划仅要求恢复 thread，不在本任务新增本地全量聊天历史持久化或历史列表。

后端退出登录返回 visitor_rotation_required 的行为作为已有身份契约处理：出现时停止旧会话，并用现有清理函数隔离旧 visitor/thread；不将所有普通登录状态变化都当作新会话。账号边界不清楚时显示明确失败，不读取旧账号会话。

## 五、T07 — 完成 Frontend State Provider 与同步接入

### 1. 文件

新增：src/agent/state/provider.tsx、src/agent/hooks/useAgentState.ts。

复用：state/types.ts、collector.ts、synchronizer.ts、adapter.ts。

修改：T04 client.ts 的状态发送接入、index.ts 导出；不重复实现 diff 算法。

### 2. provider.tsx

#### AgentStateContext / AgentStateContextValue

存放 state 及下面的 setter。cart/product 等都是现有状态的最小投影，不维护另一套商品或购物车业务模型。

#### AgentStateProvider({ children })

作用：整合路由、市场、商品、购物车、用户显示状态与聊天开关。

大致实现：读取 usePathname、useParams、useCatalogIdentity、useCart；结合 Bridge 上报的字段调用 collectFrontendState，再交给现有 FrontendStateSynchronizer。相同语义状态不重复递增。每个 thread 使用独立同步基线。

当前 useCart 只有抽屉开关，没有 itemCount；数量由 T11 购物车 Bridge 从现有 lines 投影，未知时保留未知，不能凭空填成真实空购物车。

| 函数                          | 作用                       | 大致实现                                              |
| ----------------------------- | -------------------------- | ----------------------------------------------------- |
| setProductState(product)      | 写入商品语义状态           | 只接收已定义最小字段，经 collector 清理               |
| clearProductState(productId?) | 商品离开后清理             | 检查当前归属后清空，防止旧页面卸载清掉新商品          |
| setCartState(cart)            | 补充现有购物车摘要         | 接收 itemCount 等投影；开关仍由 useCart 提供          |
| setCheckoutState(checkout)    | 写入已有 Checkout 步骤提示 | 不传 checkout ID/支付数据；没有对应来源时保留 null    |
| setUserState(user)            | 写入登录显示状态           | 只写状态，不接受 user ID；可信身份始终由 T03 解析     |
| setChatOpen(open)             | 同步聊天开关               | 作为 UI 开关唯一状态源，UI 不再另建副本               |
| getCurrentState()             | 供工具回执获取最新快照     | 返回当前 ref 指向的清理后 state，避免异步闭包读到旧值 |

### 3. 同步实现

- 本地变更：调用 synchronizer.update，更新 client 持有的待发送状态。
- 用户发起 Run：将最新快照经 toAdapterFrontendState 转换后放入官方输入。
- 工具执行后：通过 T04 submitToolResult 携带最新状态；若使用 delta，调用 toAdapterFrontendStateDelta，保证 base_version 与后端已接受版本一致。
- 网络失败：保留当前本地状态；不把“本地 diff 已产生”认作“远端已接收”。从后端确认的版本恢复，必要时重新发 snapshot。
- 新 thread：调用 synchronizer.reset；已恢复 thread 先对齐后端版本，不能一律从 0 覆盖。

后端目前的状态入口是 Run 输入和工具回执。本任务在这些入口同步，不自行增加轮询、WebSocket 或自定义 state endpoint。若验收要求活动 Run 中任意页面变化都即时推送，需先确认现有后端是否接受；未支持部分保留为 T07 的联调限制，不能伪造已同步。

### 4. useAgentState.ts

`useAgentState(): AgentStateContextValue`：读取 Provider，供 UI、商品 Bridge 和工具 Hook 使用；缺少 Provider 时给明确错误。若页面 Bridge 需在功能关闭时存在，可同文件提供 `useOptionalAgentState()`，无 Provider 返回 null，仅供这些可选 Bridge 使用。

### 5. 完成判定

路由/商品/购物车/UI 变化反映到 state；相同状态不重复同步；版本单调；工具回执包含更新后的状态；未提供的数据保持未知。原 T13 只要求 browse 页面挂载，不在本任务另增 Checkout 全局聊天面板。

## 六、T08 — Product / Storefront 状态桥接

### 1. 文件

新增：src/agent/state/product-state-bridge.tsx。

修改：

- src/app/(storefront)/[locale]/[channel]/(main)/products/[slug]/page.tsx
- src/ui/components/pdp/variant-section-dynamic.tsx
- src/ui/components/pdp/variant-selection/variant-selection-section.tsx（注册现有选择动作时使用）

### 2. product-state-bridge.tsx

#### AgentProductStateBridge(props): null

props 包含 product.id/slug/name。mount 时注册基础商品，更新时同步，unmount 时按商品归属清理。桥接位置在 ProductShell 已获取商品后的 CatalogIdentityBridge 附近。功能关闭时不要求不存在的 Provider。

#### AgentVariantStateBridge(props): null

props 包含 productId、selectedVariantId、selectedSku、selectedAttributes 的最小字段。作用：把真实选择结果合并到当前商品 state；不重复保存 variants 全列表，不把未经解析的任意 URL 参数当作有效 Variant。

大致实现：在 VariantSectionDynamic 已解析 selectedVariant 的位置传入字段，使 matrix 和 non-matrix 路径都覆盖；有必要即时反映选择时，由 VariantSelectionSection 提供已有选择状态，明确以实际解析结果完成确认。组件卸载时只清理属于自身商品的 Variant 字段。

### 3. 现有文件中的修改

- `ProductShell()`：增加基础商品 Bridge，保留现有服务端数据获取、翻译 slug 和 Suspense 结构。
- `VariantSectionDynamic()`：增加 Variant Bridge，复用已解析的 selectedVariant，不额外批量加载 Variant。
- `VariantSelectionSection()`：T11 需要驱动选择时，注册现有选择回调；原 handleSelect 和 URL/selection-index 仍是实际选择机制。

### 4. 完成判定

进入商品页有 id/slug/name；切 Variant 后 ID/SKU/属性与真实页面一致；离开后清理；商品 A 快速切 B 时不会残留 A；功能关闭不报 Context 错误。

## 七、T09 — 完成 Frontend Tool Registry 与 Executor 的运行时接入

### 1. 文件

新增：src/agent/hooks/useAgentTool.ts。

修改：

- src/agent/tools/types.ts：补执行上下文需要的已有 UI/action 回调类型。
- src/agent/tools/executor.ts：补原 confirm 风险工具的用户确认执行路径。
- src/agent/components/AIProvider.tsx：接收工具 handler、管理本次 Run 的工具状态。

复用：FrontendToolRegistry、FrontendToolExecutor 的现有注册/校验/超时/取消能力。

### 2. useAgentTool.ts

#### useAgentTool()

作用：组合 Router、最新 Frontend State、当前工具 Registry、Target Registry 和现有业务动作。

大致实现：注册表在当前 Provider 实例内稳定存在；Hook 返回下列方法。T13 中只由一个运行时桥接组件负责订阅，避免每个 UI 使用 Hook 都重复处理同一调用。

#### executeFrontendTool(name, args, callContext): Promise<FrontendToolResult>

作用：执行已收齐参数的工具调用。

大致实现：确认调用属于当前 thread/run，构造最新 context，调用 executor.execute。使用 call ID 记录正在执行/已完成结果，重复到达的同一调用复用结果，不重复修改购物车。按原 executor 约定归一化失败。

#### handleToolCall(call): Promise<void>

作用：连接 AG-UI 工具事件与本地执行器。

大致实现：校验名称、调用 ID 和完整参数；更新工具状态；调用 executeFrontendTool；执行结束后读取 T07 最新状态，调用 submitToolResult。对于导航/Variant 操作，区分“请求已发起”和“页面已更新”，不能在 router.push 返回时谎报目的页已加载。

#### toAdapterToolResult(call, result)

作用：把现有 success/error/data 结果转换成后端需要的 call_id/status/receipt 字段。

大致实现：沿用后端 FrontendToolResult 模型；映射 productId/variantId/itemCount 等最小回执为 snake_case；不包含异常堆栈或整个业务对象。不修改官方 AG-UI 事件定义。

#### confirmToolCall(callId) / rejectToolCall(callId)

作用：完成原计划 confirm 风险对应的用户确认/拒绝操作。

大致实现：从本地 pending 调用记录查找固定名称和参数；UI 展示这些已解析值。真实按钮事件确认后才继续批准路径；拒绝返回结构化取消/拒绝结果。不能接受 Agent 参数中的 confirmed=true 作为授权。

### 3. executor.ts

保留 `execute()` 现有默认限制。补充一个仅供运行时确认流程调用的执行入口，例如 `executeConfirmed(call, context, approval)`：仍执行完整参数校验、禁止工具检查、超时和取消，仅对已经由确认流程关联到该次调用的 confirm 操作放行。

approval 来源是 UI 确认后的受控记录及后端现有确认契约，不是任意布尔参数。具体后端凭据签发入口当前没有完整实现，不在此虚构；在入口可用前，confirm 工具仍返回 confirmation_required。本地确认交互可开发和 mock 测试，真实加购等确认操作的联调完成状态需单独记录。

### 4. types.ts

在现有 FrontendToolContext 上按实际使用补充可注入的动作：商品打开/选择、购物车开关和 mutation、checkout 打开、通知。回调由现有页面/Server Action 提供；工具纯逻辑不直接调用 React Hook。

不将 checkoutId、全量 lines、Saleor 用户对象加入共享 FrontendState。需要 checkout 引用的动作在受控闭包或服务端 Cookie 中处理。

### 5. 完成判定

未知工具/非法参数返回结构化失败；一个调用最多执行一次副作用；结果回传可关联原调用；取消和卸载不继续执行待处理工具；确认前不产生购物车 mutation。

## 八、T10 — 补齐 Navigation / UI Frontend Tools

### 1. 文件

| 操作 | 文件                                                    |
| ---- | ------------------------------------------------------- |
| 修改 | src/agent/tools/navigation.ts                           |
| 修改 | src/agent/tools/ui.ts                                   |
| 复用 | src/agent/tools/targets.ts                              |
| 修改 | src/agent/hooks/useAgentTool.ts：工具注册和 UI 能力注入 |
| 修改 | T08 商品 Bridge、T11 购物车 Bridge：注册实际可见元素    |

### 2. navigation.ts

#### createNavigateTool()

已有实现直接复用。现有参数名为 pathname，匹配 Adapter；不退回原文示例 href 导致不兼容。继续复用 buildStorefrontPath 与现有路径校验。

#### createGoBackTool()

作用：完成原计划“返回上一页”工具。

大致实现：parseArguments 仅接受空对象；execute 调用注入的 goBack 动作。浏览器历史不能保证目标仍在商城，使用当前运行时记录的商城访问历史判断是否有可用上一页，再复用路由导航；没有可验证上一页时返回稳定失败。这个记录只服务 go_back，不扩展成新的导航管理系统。

后端目前没有 go_back 白名单，因此本地工具保留并测试，但不冒充已可通过当前 Adapter 派发。后端支持前不对 Agent 宣告该工具可用。

### 3. ui.ts

#### createScrollToTool(targets) / createHighlightElementTool(targets)

已有实现复用。补齐注册与实际页面验证：代码用 ref 明确绑定元素，Agent 只传语义 target。沿用当前后端 product/variants/cart/checkout 名称，与原文示例的页面区域做代码内映射；不接受任意 CSS selector。

滚动不抢焦点；高亮继续使用现有设计令牌和清理逻辑。原文的 durationMs 是示例可选项，当前 wire 不支持时沿用本地配置，不向后端发送未知字段。

#### createShowNotificationTool(notify)

作用：完成原计划“显示通知”工具。

大致实现：注入 UI 通知回调；parseArguments 接受有长度限制的文本和有限的通知类型；execute 发布纯文本消息并返回 applied 回执。复用 T12 面板的 status/aria-live 显示，不添加新的通知中心、通知历史或独立页面。

后端目前没有 show_notification 白名单，处理方式同 go_back：保留本地实现与测试，真实 Agent 调用标为联调待支持。

### 4. Target 绑定

复用 `FrontendTargetRegistry.register(target, element)` 返回的清理函数：PDP 注册 product/variants，购物车页面或抽屉注册 cart。只在实际拥有可见区域的组件中注册，卸载/替换时清理。

checkout target 只有在对应页面确实存在并注册时才可用；browse 页面不伪造 checkout-summary。原 T13 没有要求在独立 Checkout 全局挂载聊天，本计划不扩大挂载范围。

### 5. 完成判定

三个已有工具连接到真实页面；不存在目标返回 target_not_found；切页面后无残留高亮；go_back 和通知本地可测，后端缺口明确。原计划的工具没有被悄悄删掉。

## 九、T11 — Product / Cart / Checkout Frontend Tools

### 1. 文件

新增原计划文件：

- src/agent/tools/product.ts
- src/agent/tools/cart.ts
- src/agent/tools/checkout.ts

为实现原计划允许的最小 Bridge / Action Export，新增：

- src/agent/state/cart-state-bridge.tsx

修改现有集成点：

- src/agent/hooks/useAgentTool.ts
- src/ui/components/pdp/variant-section-dynamic.tsx
- src/ui/components/pdp/variant-selection/variant-selection-section.tsx
- src/ui/components/cart/cart-drawer.tsx
- src/ui/components/cart/cart-drawer-wrapper.tsx
- src/app/(storefront)/[locale]/[channel]/(main)/cart/page.tsx
- src/app/actions.ts
- src/ui/components/cart/cart-mutations.ts（补结构化 mutation 返回类型时）
- src/ui/components/plp/use-product-filters.ts
- src/graphql/CheckoutAddLine.graphql

商品 ID 到路由的查询若现有查询不能复用：在本任务内新增 `src/graphql/AgentProductRoute.graphql`，并在 src/app/actions.ts 增加对应最小查询动作。这个查询只支撑原 open_product，不扩展推荐/搜索服务。

### 2. product.ts

#### createOpenProductTool(actions)

作用：打开商品。

大致实现：本地动作可接受原计划 slug，Adapter 入口按当前契约接受 product_id；通过现有商品信息或服务端最小查询解析当前 locale 的 slug，再调用 buildStorefrontPath 与 Router。禁止把 product_id 当作 slug 拼接。查询无结果、商品不可用时返回失败。

#### createSelectVariantTool(actions)

作用：驱动现有 PDP Variant 选择机制。

大致实现：本地保留原计划 variantId/sku/attributes 入口，Adapter 输入转换 product_id/variant_id。检查当前商品匹配；复用现有 selection-index、URL 参数机制和已注册选择回调，不创建 AgentVariantStore。不存在或不属于当前商品的 Variant 返回失败。选择结果由 T08 Bridge 反映回 state。

SKU/属性定位不能靠截断的 Variant 列表猜测唯一匹配；现有 PDP 无法解析时给稳定失败，不新增高基数全量抓取。

#### createSetProductFiltersTool(actions)

作用：修改当前商品列表的已有筛选条件。

大致实现：只接受现有 PLP 支持的类别、颜色、尺码、价格、排序字段；调用 useProductFilters 暴露的 applyAgentFilters 回调。参数序列化、游标清理、导航复用原 updateFilters 逻辑，不重复创建筛选状态。非列表页返回失败。

后端当前不包含 set_product_filters：保留原任务中的本地工具，待契约支持后再声明给 Agent；不能标为端到端完成。

### 3. cart.ts

每个工厂返回现有 FrontendTool 接口：name、description、risk、parseArguments、execute；不新建另一套工具基类。

| 函数                                  | 作用         | 大致实现                                                                                                           |
| ------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| createOpenCartTool(actions)           | 打开抽屉     | 调用 useCart().openCart 注入的动作；state 从现有开关同步                                                           |
| createAddToCartTool(actions)          | 加入购物车   | 校验 variantId 和正整数 quantity；Adapter product_id/variant_id 做映射与商品关系校验；确认后调用共享 Server Action |
| createUpdateCartQuantityTool(actions) | 修改某行数量 | 使用 lineId/quantity；当前 Adapter 声明名称为 change_quantity；确认后调用现有购物车 mutation                       |
| createRemoveFromCartTool(actions)     | 删除购物车行 | 校验 lineId；确认后调用现有删除动作；返回真实 mutation 结果                                                        |

add_to_cart、修改数量、删除按当前后端策略进入 confirm；不为满足流程演示降低现有风险限制。

### 4. checkout.ts

#### createOpenCheckoutTool(actions)

作用：进入当前购物车的 Checkout。

大致实现：从受控购物车动作取得当前结账跳转信息；复用 `@paper/session-bridge` 的 buildCheckoutPath 和现有 CheckoutLink 的跳转方式。无有效购物车时返回失败或展示现有空购物车提示。跨 surface 跳转前结束本次待回传工作，不能在页面离开后假定原 runtime 仍存在。

只打开 Checkout，不生成支付、complete_checkout 或 place_order 工具。

### 5. cart-state-bridge.tsx

#### AgentCartStateBridge({ itemCount }): null

作用：将真实购物车数量投影给 Agent。

大致实现：从 CartDrawerWrapper/cart page 已有 checkout.lines 计算数量，传入最小 props；Bridge 调用 setCartState，不把 checkoutId 或全量 lines 放进 state。状态未知和已知 0 区分。Drawer 隐藏不等于购物车变空。

#### useAgentCartBindings(bindings)

作用：注册真实购物车动作和可见目标元素。

大致实现：在现有 CartDrawer 或购物车页内调用，注入 openCart、mutation、checkout 跳转和 cart 元素 ref；返回/执行清理函数。内部 checkout 引用只留在业务动作闭包，不进入发送给 Agent 的语义状态。若用单个 Bridge 组件容纳这些绑定，可合并，不必重复建文件。

### 6. src/app/actions.ts

#### addCartLine({ channel, localeSlug, variantId, quantity })

作用：把当前 VariantSectionDynamic 内嵌的 addToCart 核心逻辑抽成现有 Storefront 与 Agent 共用的 Server Action。

大致实现：从 Cookie 读取 checkout，复用 Checkout.findOrCreate/saveIdToCookie；调用 CheckoutAddLineDocument；检查传输错误及 Saleor errors；返回最小结构化成功/失败结果；成功时保留现有 refresh 和商品加购事件行为。普通 PDP 包装函数仍默认 quantity=1。

#### deleteCartLine(...) / updateCartLineQuantity(...)

作用：复用已有 mutation，给工具准确结果。

大致实现：保留原页面调用方式和刷新行为，补充结果返回及业务错误判断。现有函数仅返回 void，不能“没有抛异常”就判定工具成功；必要时让共享内部实现返回结果，旧 UI 包装继续接受 void 用法。

Agent 调用时从当前 Cookie 对应购物车确定可操作的行；不让模型通过任意 checkoutId 操作其他购物车。此为原“复用现有购物车流程”的实现约束，不新增购物车服务。

#### resolveAgentProductRoute(productId, channel, localeSlug)

作用：仅在现有商品数据无法给出路由时，为 open_product 查询当前市场的最小商品信息。

大致实现：复用服务端 GraphQL helper 和实际 schema 查询 id/slug/必要翻译，返回经过 path builder 构造的本站路径；不接受外部完整 URL。

### 7. 其余现有文件中的修改

- `VariantSectionDynamic.addToCart()`：改为调用共享 addCartLine，保留原 PDP 表单与默认数量。
- `VariantSelectionSection()`：注册选择动作，复用原 handleSelect/URL 更新；卸载时撤销。
- `CartDrawerWrapper()`、购物车页数据组件：在已有数据处产生 itemCount 并挂 Bridge，不增加顶层 layout 的购物车请求。
- `CartDrawer()`：把现有 handleRemove/handleQuantityChange/checkoutHref 能力提供给 Bridge；按 mutation 的真实结果更新状态。
- `useProductFilters()`：增加 `applyAgentFilters(filters)` 返回方法，内部调用同一 updateFilters；不逐个 toggle 导致重复导航或参数互相覆盖。

### 8. GraphQL 文件

`CheckoutAddLine.graphql` 当前写死 quantity: 1。改为 `$quantity: Int! = 1` 并传给 lines.quantity，使原页面兼容、Agent 可使用原计划 quantity 参数。根据实际生成类型更新调用方。

若新增 `AgentProductRoute.graphql`，只定义商品路由所需最小查询，字段按实际 schema。两处变更后运行 `pnpm generate`，不手工编辑 src/gql。

### 9. 完成判定

打开商品 → 切换 Variant → 打开 Cart → 用户确认加购 → 数量/删除确认 → 进入 Checkout 可实际完成；页面与 Agent state 一致；失败不会显示成功；原有普通 PDP 和购物车交互不回归。确认入口或后端工具白名单尚未具备的项逐项标待联调，不用 mock 结果冒充真实验收。

## 十、T12 — Chat UI Components

### 1. 文件

按原计划新增七个文件：

- src/agent/components/AIButton.tsx
- src/agent/components/AIPanel.tsx
- src/agent/components/AIChat.tsx
- src/agent/components/AIMessageList.tsx
- src/agent/components/AIMessage.tsx
- src/agent/components/AIInput.tsx
- src/agent/components/AIToolStatus.tsx

修改 messages/en.json、de.json、fi.json、fr.json、ja.json、ko.json、nb.json、pl.json，按项目现有 next-intl 方式补相同的 agent 文案键。文案是原聊天 UI 的实现内容，不引入新的翻译系统。

### 2. AIButton.tsx

#### AIButton()

作用：右下角聊天入口。

大致实现：读取 T07 chatOpen，点击调用 setChatOpen；用现有 Button、设计令牌和图标。提供 aria-label、aria-expanded、aria-controls，适配移动端 safe area。按钮不直接启动 Run。

### 3. AIPanel.tsx

#### AIPanel()

作用：承载 Drawer / 浮动聊天面板。

大致实现：复用现有 Dialog/Sheet primitive；open 由 T07 统一管理；提供关闭、标题和原 T05 新会话按钮。处理键盘关闭、焦点进入与回到入口、窄屏布局。关闭面板只改变显示，不等于新会话或清空消息。

内部 `handleOpenChange(open)` 调用 setChatOpen；`handleNewConversation()` 调用 useAgentThread 的 startNewConversation。复用可访问性 primitive，不手写另一套弹窗系统。

### 4. AIChat.tsx

#### AIChat()

作用：组合聊天内容和输入区。

大致实现：从 useAgent 读取 messages/status/toolStatus/error，组合 AIMessageList、AIToolStatus、AIInput；显示 Run Error 和 T10 本地通知的纯文本状态区。空状态只展示原聊天入口需要的提示，不新增推荐卡片或业务推荐能力。

### 5. AIMessageList.tsx

#### AIMessageList({ messages })

作用：展示消息列表和流式更新。

大致实现：以稳定 message ID 为 key；使用滚动容器 ref 与列表尾部 ref，初次打开或用户仍靠近底部时滚动到最新内容。用户主动向上阅读时不强制拉回底部。

内部 `handleScroll()` 记录是否接近底部；`scrollToLatest()` 只负责滚动。新 token 更新不重新创建整条消息 ID。

### 6. AIMessage.tsx

#### AIMessage({ message })

作用：显示 user、assistant、status/system 消息。

大致实现：用户内容按文本渲染；assistant 使用受控 Markdown 渲染。禁用原始 HTML，若所用渲染器会生成 HTML则通过现有/明确配置的 sanitizer 处理；限制危险链接协议。不对模型文本直接使用未经清理的 dangerouslySetInnerHTML。

内部 `renderMessageContent(message)` 根据角色选择渲染方式。Markdown 渲染依赖若需新增，只在 package.json/lockfile 记录实际使用包，不增加富内容扩展功能。

### 7. AIInput.tsx

#### AIInput()

作用：输入、发送和取消。

大致实现：组件本地只存输入草稿；运行状态来自 useAgent。提供 textarea、发送和停止按钮；发送中不重复提交；校验长度与空白。

| 内部函数             | 作用与实现                                                   |
| -------------------- | ------------------------------------------------------------ |
| handleChange(event)  | 更新草稿，按统一限制控制长度                                 |
| handleSubmit(event?) | 阻止默认提交，检查文本，调用 sendMessage；按提交结果处理草稿 |
| handleKeyDown(event) | Enter 发送、Shift+Enter 换行；输入法 composing 时不误发送    |
| handleCancel()       | 调用 cancelRun，不清掉已有回复                               |

### 8. AIToolStatus.tsx

#### AIToolStatus({ status })

作用：展示原工具执行状态和 confirm 操作。

大致实现：通过固定文案映射显示“正在切换规格”等用户可理解内容；不展示 raw arguments。状态为待确认时展示已校验的商品/数量等必要摘要，确认/拒绝按钮调用 T09 对应方法。成功、失败、取消分别展示。

#### getToolStatusLabel(status)

作用：把内部工具名与执行状态映射到 i18n 文案；未知工具使用通用描述，不直接把内部名称显示给用户。

确认 UI 是原工具 confirm 风险模型的界面，不扩展为通用审批系统。

### 9. 完成判定

仅注入 mock 事件即可验证开关、消息、流式回复、工具状态、错误、取消和确认交互；桌面/移动端无明显遮挡；键盘和焦点行为正确；原始模型 HTML 不执行。

## 十一、T13 — Storefront 全局集成

### 1. 文件

修改：src/ui/components/storefront-providers.tsx、src/agent/index.ts。

仅现有边界确实需要时修改 src/app/(storefront)/[locale]/[channel]/(main)/layout.tsx；默认不动其同步结构。

### 2. storefront-providers.tsx

#### StorefrontProviders({ children })

作用：保持现有 Cart/Catalog Provider，在功能启用时挂载 Agent。

大致实现：在现有 CartProvider → CatalogIdentityProvider 内检查 isAgentEnabled；关闭时渲染原 children；开启时挂载下述 Agent 层。功能关闭不创建 client、不访问 localStorage、不发送 Agent 请求。

#### AgentIntegration({ children })

作用：组织原计划的 Provider 和 UI。

同文件内部组件即可，不额外拆业务目录：

```text
CartProvider
  CatalogIdentityProvider
    AIProvider
      AgentStateProvider
        AgentRuntimeBridge
        children
        AIButton
        AIPanel
```

#### AgentRuntimeBridge(): null

作用：在能同时访问 AIProvider 和 AgentStateProvider 的层级连接状态与工具。

大致实现：只挂载一个桥接实例，调用 T09 useAgentTool 注册工具调用 handler，连接最新状态、工具声明和回执；Effect cleanup 撤销注册、取消待执行工具、清理 Target Registry。业务代码仍在 src/agent，当前内部组件只负责接线；也可作为已有 useAgentTool.ts 的小组件导出，二者择一，不重复订阅。

### 3. index.ts

导出已实现的 AIProvider、AgentStateProvider、AIButton、AIPanel 及需要的 Hook；不导出 server-only resolver 或服务端凭据逻辑。每个导出对应真实实现，不创建空文件占位。

### 4. Layout 处理

不为初始化 Agent await 用户/购物车；页面主要内容不包入等待 Agent 请求的 Suspense。确有新增路由 Hook 动态边界时按本地 Next.js 文档处理，并运行 build 检查 PPR。独立 Checkout surface 不在本任务新增全局聊天入口。

### 5. 完成判定

全部 browse 页面可见聊天入口；路由切换保持会话运行时；同一工具调用只有一个订阅处理；关闭开关回到原行为；普通商品/购物车流程正常；主内容 streaming 与 PPR 不因 Agent 鉴权等待。

## 十二、T14 — 补齐测试与主链路验收

### 1. 测试文件安排

服从当前仓库 colocated 测试习惯，不再创建平行的 tests/agent 目录。原计划 visitor/thread 的用例已经在 browser-identity.test.ts 中覆盖，继续复用。

| 操作            | 文件                                                                     | 对应原计划覆盖范围                      |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| 复用/补充       | src/agent/identity/browser-identity.test.ts                              | visitor/thread 生成、刷新、清理、新会话 |
| 复用/补充       | src/agent/identity/session-user.test.ts                                  | 身份三态                                |
| 新增            | src/app/api/agent/route.test.ts                                          | 原 agui-route.test.ts                   |
| 新增            | src/agent/agui/client.test.ts                                            | Client/Transport 流式、取消、回执       |
| 新增            | src/agent/components/provider.test.tsx                                   | AIProvider 生命周期                     |
| 新增            | src/agent/state/provider.test.tsx                                        | T07 Provider 与同步接入                 |
| 新增            | src/agent/state/product-state.test.tsx                                   | Product/Variant Bridge                  |
| 新增            | src/agent/tools/runtime.test.tsx                                         | Hook、调用去重与结果回传                |
| 新增            | src/agent/tools/commerce.test.ts                                         | Product/Cart/Checkout 工具              |
| 新增            | src/agent/components/chat.test.tsx                                       | Chat UI                                 |
| 补充            | src/agent/tools/navigation.test.ts、ui.test.ts、executor.test.ts         | go_back、通知、确认及真实绑定的对应单测 |
| 复用/必要时补充 | src/agent/state/collector.test.ts、synchronizer.test.ts、adapter.test.ts | 状态清理、版本与后端投影                |
| 新增            | e2e/agent.spec.ts                                                        | 原计划主链路 E2E                        |
| 修改            | vitest.config.ts                                                         | 收集 .test.tsx、支持新增 React 测试     |
| 必要时修改      | vitest.setup.ts、package.json、pnpm-lock.yaml                            | React 测试 DOM 环境及实际需要的测试依赖 |

测试文件以 describe/it/test 为主，不生成无用途的业务类。以下列出各新增文件的测试组与必要 helper；helper 在文件内部即可。

### 2. route.test.ts

测试组：guest、authenticated、unavailable、伪造用户字段、流式响应、上游错误、取消。

- `createAgentRequest(overrides)`：生成符合正式输入类型的请求，允许覆盖伪造身份字段测试。
- `createStreamingUpstream()`：返回可分段写入的 ReadableStream，验证第二段未产生时第一段已能读取，避免只能检查 Content-Type 的假 streaming 测试。
- mock 现有 resolveAgentSessionUser 和 fetch；断言发给上游的身份来自服务端，而不是浏览器值。

### 3. client.test.ts

测试组：SSE 增量、Run Error、HTTP 失败、cancel、dispose、工具回执。

- `createAguiEventStream(events)`：使用官方编码/类型生成事件流，按块发送。
- `createTransportStub()`：提供可控制响应/取消的 transport，不连接真实公网。
- 验证同一文本消息增量不会生成多条独立消息；回执携带正确 thread/run/call ID；回执分支不混入新用户消息。

### 4. components/provider.test.tsx

测试组：mount 初始化、thread 恢复、新会话、unmount abort、迟到事件隔离。

- `createClientStub()`：记录 run/cancel/subscribe/dispose 调用并可注入官方事件。
- `renderAgentProvider()`：挂 Provider 与只供测试读取 context 的探针组件。
- 验证 new conversation 保留 visitor；匿名转登录不自动创建新 thread；Run 中卸载取消。

### 5. state/provider.test.tsx

测试组：路由/Catalog/Cart 输入、去重、版本、新会话 reset、失败后的基线处理。

- `renderStateProvider(sources)`：使用可替换的路由和已有 Context 数据挂载。
- `updateStorefrontSources(patch)`：在测试中模拟真实来源变化，检查调用次数和发出的状态。
- 验证 CartContext 仅有开关时不会假造 itemCount；本地 diff 产生不等于远端确认。

### 6. product-state.test.tsx

测试组：商品 mount/unmount、A→B 切换、Variant 改变、无选择、功能关闭。

- `renderProductBridge(product, variant)`：在测试 Provider 中挂基础和 Variant Bridge。
- 用 rerender 模拟真实选中结果变化，验证 ID/SKU/属性一致，旧清理不会删除新商品状态。
- 同时覆盖普通 matrix 与服务端解析 selectedVariant 的 non-matrix 场景。

### 7. tools/runtime.test.tsx

测试组：完整参数才执行、未知工具、重复 call ID、结果映射、取消、确认/拒绝。

- `createToolCall(overrides)`：构造当前协议的合法调用。
- `createRuntimeHarness()`：注入 registry、最新 state getter、回执发送 stub。
- 断言重复事件只执行一次 mutation；旧 thread 调用不执行；拒绝确认不改变购物车；工具结果绑定正确调用和更新后 state。

### 8. tools/commerce.test.ts

测试组：商品路由、Variant 匹配、筛选、打开 Cart、加购、改数量、删除、Checkout。

- `createCommerceActions()`：以 spy 模拟现有业务动作，验证参数与调用次数。
- `createToolContext()`：提供当前市场与商品 state，不提供任意 Saleor 管理权限。
- 验证原计划 quantity 确实传到 Server Action；服务端业务失败不能回报 success；confirm 操作未批准时不调用动作；Checkout 仅跳转，不触发支付。

需要验证共享 Server Action 的具体 GraphQL 错误/数量行为时，在同任务新增 `src/agent/tools/commerce-actions.test.ts`，mock 既有服务端 helper 验证真实返回分支，不依赖真实下单。

### 9. components/chat.test.tsx

测试组：开关面板、发送、流式文本、状态、错误、cancel、新会话、确认、键盘与内容安全。

- `renderChat(initialState)`：挂必要 Provider 和七个 UI 组件。
- `emitAgentEvent(event)`：让 mock client 推送正式类型事件。
- 验证空白不发送、中文输入法 Enter 不误发、Shift+Enter 换行、关闭后焦点回入口、危险 HTML 不执行；工具 UI 不显示原始参数。

### 10. e2e/agent.spec.ts

使用现有 Playwright。测试函数包括：

1. `test('guest chat streams a response', ...)`：打开入口、发送消息、看到增量内容。
2. `test('thread survives navigation and reload', ...)`：导航/刷新保留 thread；不额外要求原计划外的本地历史恢复。
3. `test('product and variant context follow the page', ...)`：进入真实 PDP、切换 Variant、检查发出的语义状态。
4. `test('agent tools complete the shopping path', ...)`：打开商品、选规格、打开 Cart、确认加购、进入 Checkout；不支付。
5. `test('cancel and new conversation isolate runs', ...)`：停止/新会话后旧输出不污染新会话。
6. `test('feature flag disables agent integration', ...)`：在关闭 flag 的运行配置下无入口和 Agent 请求。

`mockAgentStream(page, scenario)` 可为可重复的 UI 场景提供 SSE；真实 Adapter 联调用独立环境执行同一核心用户链路。mock 通过不代表真实 BFF/Adapter 身份验证通过，报告分别记录。

### 11. 测试配置

`vitest.config.ts` 当前只 include `src/**/*.test.ts`。补上 `src/**/*.test.tsx`；React 测试按文件指定 DOM 环境，已有纯逻辑测试继续 node。按实际安装的 DOM/组件测试库配置 setup；不得仅添加 .tsx 测试文件却不被 test runner 收集。

功能开关是 build-time public env，E2E 的开/关场景采用相应启动配置，不假定页面运行时修改环境变量即可生效。

### 12. 完成判定

- 原有 158 个 Agent 测试保持通过，新增测试实际被收集执行。
- 每项 GraphQL 改动执行相应 generate。
- `pnpm run verify` 全绿；触及 PPR 敏感集成时 `pnpm run build` 通过。
- UI mock、真实浏览器、真实 Adapter 联调分别有结果；未执行的不写“通过”。
- 完整验证需要有效 NEXT_PUBLIC_SALEOR_API_URL；当前环境缺少此项，这是验收条件，不新增开发任务。

## 十三、原计划与当前后端差异归属表

以下只标注影响哪个原任务，不增加 T15 或新的基础设施开发批次。

| 差异                                                                | 归属        | 本计划处理                                                                   |
| ------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| 原示例把 storefrontIdentity 放入 JSON，后端要求 verified context    | T03         | BFF 使用真实验证契约；当前缺口标真实联调条件，不伪造鉴权                     |
| forwardedProps 当前只允许 toolResults                               | T03/T04     | visitor 提示由 BFF 单独接收处理；回执使用既有分支                            |
| State 的 snake_case、字段白名单、版本规则                           | T07         | 复用已有 adapter.ts，不重写模型或扩字段                                      |
| 商品名称/slug/SKU 当前不进入后端 ProductState                       | T07/T08     | 保留本地语义字段，线上投影只发当前支持字段                                   |
| navigate 使用 pathname；工具目标使用 product/variants/cart/checkout | T10         | 保留当前已对齐实现                                                           |
| go_back/show_notification/set_product_filters 暂无后端白名单        | T10/T11     | 原定本地实现保留；后端支持前不声明可调用，端到端状态标待联调                 |
| open_product 使用 product_id                                        | T11         | 当前市场商品 ID→slug→path 的最小解析                                         |
| select_variant 使用 product_id/variant_id                           | T11         | 在边界映射为现有 PDP 动作参数                                                |
| 修改数量叫 change_quantity                                          | T11         | 保留原工厂名，wire 名称匹配后端                                              |
| add_to_cart 也需要确认；后端确认签发入口尚不完整                    | T09/T11/T12 | 实现原 confirm UI/执行流程；真实批准链路等待现有契约接通，不添加独立审批产品 |
| 退出登录可能要求 visitor rotation                                   | T05         | 响应现有错误并隔离身份；普通匿名转登录仍保持 thread                          |

### 参考源码

- 本地实现与进展：[agent-integration.md](./agent-integration.md)。
- 后端请求及身份：[router.py](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/agui/router.py)、[schemas.py](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/agui/schemas.py)、[factory.py](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/app/factory.py)。
- 后端请求/回执分支：[input_adapter.py](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/agui/input_adapter.py)、[runner.py](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/agui/runner.py)。
- 后端状态与工具：[state/models.py](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/frontend/state/models.py)、[tools/policy.py](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/frontend/tools/policy.py)。
- 后端确认与身份切换：[frontend_tool_policy.py](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/security/frontend_tool_policy.py)、[resolver.py](https://github.com/Ceasar44/agent_adapter_service/blob/main/src/agent_adapter_service/customer_identity/resolver.py)。
