# LayoverJoy Qoder 工程验收审查报告

> 审查日期：2026-08-29  
> 审查对象：`alibaba/project/` 现有 Android、后端、Worker、Docker、Daytona 与文档实现  
> 用途：请 Qoder 依据本报告逐项核对、修复，并提交可复现的验收证据  
> 审查限制：本次只进行静态代码、配置和部署页面检查；未修改业务代码，未运行测试、构建、Atlas 请求或 Nosana 推理请求。因此，本文不会把“代码存在”误写成“运行验证通过”。

## 一、结论先行

当前工程已经搭起较完整的产品骨架，但**还不能认定已经满足此前交给 Qoder 的全部要求，也不宜按当前状态直接用于最终评审 Demo**。

主要问题不在页面数量，而在四条核心卖点尚未形成可信的端到端证据：

1. Nosana 调用代码已经存在，但部署 ID 没有进入工程配置模型，Android 只在详情页手动触发生成，部署日志中也没有本次审查可见的真实推理请求证据。
2. Daytona 后端部署能力已经接入，但“每个候选方案在隔离沙箱中完成评估”的关键逻辑并未实现；远端沙箱当前只执行一条 `echo`，实际评分仍在主后端进程执行。
3. Atlas Sandbox Adapter 已编写，但没有真实脱敏 Search/Verify 请求响应 fixture，且没有使用 `atlas-flight-booking-skill` 的标准化契约，违反项目自己的 Atlas 接入门槛。
4. Visa-aware Routing、双订单补偿、监控通知等模块存在会导致错误业务结论的逻辑缺口，不能只作为“待优化项”处理。

建议 Qoder 先完成本文 P0，再补 P1；P0 未完成之前，不要在演示文稿中声称“Atlas、Daytona、Nosana 已完成真实端到端闭环”。

## 二、NOSANA_API_KEY 的明确结论

### 2.1 目前能够确定的事实

本机文件 `alibaba/.secrets/layoverjoy.env` 中保存的值**字面上就是**：

```dotenv
NOSANA_API_KEY=nos_••••••••••••••••••••947g
```

它是页面脱敏后的占位字符串，不是完整 API Key。工程目录、现有文档和本机该 secrets 文件中都没有发现可恢复的完整值，因此：

> **完整 NOSANA_API_KEY 的确切内容目前未知，无法从 `nos_••••••••••••••••••••947g` 反推出原值。**

这不是因为本报告刻意隐藏密钥，而是因为原始明文并不存在于已检查的本地材料中。Nosana 官方文档也说明，API Key 明文只会在创建时返回一次；如果当时没有保存，只能创建新 Key，不能从掩码恢复。参见 [Nosana API Authentication](https://learn.nosana.com/api/auth) 和 [Get an API Key](https://learn.nosana.com/api/get-api-key.html)。

### 2.2 当前推理调用其实不应依赖这个管理 Key

目前 Nosana 部署暴露的是 Ollama OpenAI-compatible endpoint。Ollama 官方兼容文档说明，OpenAI 客户端虽然可能要求传一个 `api_key` 参数，但该值会被 Ollama忽略；本地 Ollama API 本身也不要求认证。参见 [Ollama OpenAI compatibility](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx) 和 [Ollama Authentication](https://docs.ollama.com/api/authentication)。

因此需要区分两个概念：

| 配置 | 用途 | 当前是否需要 |
| --- | --- | --- |
| `NOSANA_API_KEY` | 调用 Nosana deployment management API，例如创建、更新、查询或删除部署 | App 只调用现有推理 endpoint 时不需要；若后端要管理部署，则必须新建并保存完整 Key |
| `NOSANA_OPENAI_BASE_URL` | 调用部署内 Ollama 的 `/v1/chat/completions` | 需要 |
| `NOSANA_MODEL` | 指定部署中已加载的模型 | 需要 |
| `NOSANA_DEPLOYMENT_ID` | 形成评审证据、状态页和可追踪性 | 强烈需要，但不得拿它代替鉴权 Key |
| `NOSANA_INFERENCE_AUTH_TOKEN` | 仅在 endpoint 前方另有鉴权代理时使用 | 当前 Ollama 直连场景不需要 |

当前 `nosana.service.ts` 把 `NOSANA_API_KEY` 当成推理 Bearer Token，并要求 Key 和 endpoint 同时存在。这是**管理面凭据与推理面鉴权混淆**。由于掩码字符串非空，代码仍会尝试请求；Ollama 可能忽略这个错误 Bearer Token，所以请求不一定失败，但这种实现语义错误、健康检查会误报，并会让 Qoder误以为必须拿到完整管理 Key 才能做推理。

### 2.3 已确认的 Nosana 部署信息

本次通过用户已登录的 Nosana 部署页面进行只读检查，确认：

```text
Deployment name: layoverjoy-itinerary-agent
Deployment ID: 61xyaFH33U6YJWLd9kB1VUXTz5JUSPxfESzVY5V9BfGw
Deployment status: RUNNING
Endpoint status: ACTIVE
OpenAI base URL: https://Pc92R5kVpsduYcpNkZTBMfLEFcyWmsLR7fMWRDnNkVZQ.node.k8s.prd.nos.ci/v1
Container: docker.io/ollama/ollama:0.32.6
Model: qwen3.5:9b
Port: 11434
Strategy: Infinite, 1 replica
GPU: NVIDIA 3060
```

部署页面可见日志只包含启动、镜像、网络和资源管理事件，没有发现可证明 LayoverJoy 已发送 `/v1/chat/completions` 请求的推理日志。这里只能认定“部署在线”，不能认定“产品已经真实使用部署”。

### 2.4 Qoder 必须调整的 Nosana 配置模型

建议改为以下职责分离。不要把真实管理 Key 写入源码、Android APK、Markdown 或 Git：

```dotenv
INFERENCE_PROVIDER=nosana
NOSANA_OPENAI_BASE_URL=https://Pc92R5kVpsduYcpNkZTBMfLEFcyWmsLR7fMWRDnNkVZQ.node.k8s.prd.nos.ci/v1
NOSANA_MODEL=qwen3.5:9b
NOSANA_DEPLOYMENT_ID=61xyaFH33U6YJWLd9kB1VUXTz5JUSPxfESzVY5V9BfGw
NOSANA_INFERENCE_AUTH_MODE=none

# 只有实现部署管理 API 时才配置，且必须通过 Secret 注入：
# NOSANA_API_KEY=nos_<new-full-management-key>
```

Qoder 验收要求：

| 编号 | 必须完成的结果 |
| --- | --- |
| NOS-01 | `env.ts` 接受并校验 `NOSANA_DEPLOYMENT_ID`，拒绝包含 `•`、`*`、`REPLACE_ME` 等掩码或占位符的 Secret |
| NOS-02 | 推理请求只依赖 base URL 和 model；只有显式配置 inference auth 时才发送 Authorization header |
| NOS-03 | `NOSANA_API_KEY` 仅供 Nosana 管理 API 使用，不再作为 Ollama 推理的必要条件 |
| NOS-04 | Android 触发生成后，结果明确显示 `provider=NOSANA`、deployment ID 后 8 位、model、latency 和生成时间；失败时明确显示 `TEMPLATE_FALLBACK` 及原因分类 |
| NOS-05 | 保存一份脱敏真实请求响应 fixture，以及对应时间戳、HTTP status、model 和 deployment ID；不得把完整证件信息或 Secret 放进 fixture |
| NOS-06 | 健康状态区分 `configured`、`endpointReachable`、`lastInferenceSucceededAt`，不得仅用“环境变量非空”判断服务健康 |

## 三、P0：必须先修复的阻塞问题

### P0-01 Nosana 尚未形成可证明的产品闭环

**证据**

| 位置 | 发现 |
| --- | --- |
| `backend/src/config/env.ts:35` | 有 API Key、base URL、model，但没有 deployment ID |
| `backend/src/explanations/nosana.service.ts:59` | Key 和 base URL任一为空就回退模板，错误绑定管理 Key |
| `backend/src/explanations/nosana.service.ts:81` | 调用 `/chat/completions`，说明本质是 Ollama/OpenAI-compatible 推理 |
| `backend/src/explanations/nosana.service.ts:86` | 无条件发送 `Authorization: Bearer NOSANA_API_KEY` |
| `backend/src/health/health.controller.ts:47` | 只根据配置非空报告 Nosana 已配置，掩码字符串也会被当作有效 |
| `android/app/src/main/java/com/yuanhe/layoverjoy/ui/PlanDetailScreen.kt:187` | Nosana 只在详情页点击按钮时调用，不是搜索规划主流程的一部分 |

**影响**

评委可能看到模板结果而以为是 Nosana；工程也无法证明正在使用指定 deployment。当前掩码 Key 不是主要阻塞点，错误的配置职责和缺少运行证据才是。

**Qoder 动作**

按第二章 NOS-01 至 NOS-06 完成。保留安全的模板回退，但必须在 API 和 UI 上诚实标明 provider，不得把 fallback 显示为 Nosana。

### P0-02 Android 搜索主流程没有使用 Daytona Planning Jobs

**证据**

| 位置 | 发现 |
| --- | --- |
| `android/app/src/main/java/com/yuanhe/layoverjoy/data/Api.kt:82` | Android API 没有 planning-jobs 接口 |
| `backend/src/planning-jobs/planning-jobs.controller.ts:8` | 后端存在 `/api/v1/planning-jobs`，但没有被 App 搜索流程调用 |
| `android/app/src/main/java/com/yuanhe/layoverjoy/ui/MainScreen.kt:147` | 导航中没有 Daytona 执行状态或候选沙箱证据页 |
| `backend/src/config/env.ts:41` | `DAYTONA_MODE` 默认 `local-runner`；现有 secrets 没有覆盖该值 |

**影响**

产品可以部署在 Daytona，不等于核心 Agent 规划任务使用了 Daytona。当前实现对 Daytona Hacksprint 的差异化证据不足。

**Qoder 动作**

将一次用户搜索映射为一个 planning job。可由 Android 直接创建 job，也可由 `/v1/searches` 在后端内部编排，但必须只有一个正式入口，避免两套搜索结果漂移。App 应展示候选数、沙箱状态、完成数和降级状态，不展示 Secret。

### P0-03 Daytona 沙箱当前只执行 echo，实际评估仍在主后端

**证据**

| 位置 | 发现 |
| --- | --- |
| `backend/src/planning-jobs/daytona.runner.ts:81` | 创建远端沙箱后只执行 marker/echo 命令 |
| `backend/src/planning-jobs/daytona.runner.ts:102` | `evaluate()` 在主后端本地执行，不在候选沙箱中执行 |
| `backend/src/planning-jobs/daytona.runner.ts:111` | DELETE 响应未校验，仍记录“destroyed” |
| `backend/src/planning-jobs/planning-jobs.service.ts:145` | `sandboxCleanedUp: true` 被无条件写入 |
| `AGENTS.md:90` | 项目规则要求所有路径清理沙箱，并产生结构化执行证据 |

**影响**

这不能支撑“每个候选 itinerary 在隔离 Daytona sandbox 中执行和评分”的陈述；清理失败也会被伪装为成功。

**Qoder 动作**

把脱敏后的候选输入写入沙箱，在沙箱内运行确定性 evaluator，输出版本化 JSON artifact，再由主后端汇总。必须支持 timeout、cancel、partial success，并根据 DELETE HTTP status 记录真实 cleanup 状态。不得向沙箱传姓名、邮箱、证件号、Secret。

**验收证据**

一次搜索至少产生 2 个不同的 sandbox ID；每个 ID 对应输入 hash、evaluator version、输出 JSON、开始/结束时间、cleanup status。若使用本地降级，UI 和 API 必须显示 `LOCAL_FALLBACK`。

### P0-04 Android 源码和 APK 中硬编码 Daytona Preview Token

**证据**

| 位置 | 发现 |
| --- | --- |
| `android/app/build.gradle.kts:20` | BuildConfig 硬编码 Daytona Preview URL 和真实形态的 Preview Token |
| `android/app/src/main/java/com/yuanhe/layoverjoy/ui/DevSettingsScreen.kt:70` | App 从 BuildConfig 读取该 Token |
| `AGENTS.md:61` | 明确禁止把 Secret 编译进 APK |
| `TECHNICAL_IMPLEMENTATION.md:170` | 文档声称 Preview Token 只在运行时输入，与实现冲突 |

**影响**

任何拿到 APK 的人都可能提取 Token；文档与实现不一致也会降低评审可信度。

**Qoder 动作**

从 BuildConfig 删除 Token。Demo 可采用公开的短期 Preview URL、运行时手动输入短期 Token，或由本机安全配置注入后端而不是注入 APK。修复后扫描源码和 APK 字符串，提交“未发现 Token”的验收结果。

### P0-05 Visa-aware Routing 存在错误放行风险

**证据**

| 位置 | 发现 |
| --- | --- |
| `backend/src/search/search.orchestrator.ts:249` | 第二段航班尚未 Search/Verify，就把 `onwardTicketConfirmed` 写成 `true` |
| `backend/src/planning-jobs/planning-jobs.service.ts:177` | Planning Jobs 路径同样提前确认 onward ticket |
| `backend/src/entry-rules/rule-engine.ts:45` | 该字段的契约是“第二段已确认”，与调用方不一致 |
| `backend/src/entry-rules/rule-engine.ts:129` | 有效签证缺少 expiry 时仍可能被当作有效 |
| `backend/src/entry-rules/rule-engine.ts:139` | 只有明确 `false` 才进入 NEEDS_INFO，`undefined` 也可能继续放行 |
| `android/app/src/main/java/com/yuanhe/layoverjoy/ui/OnboardingScreen.kt:117` | 用户选择的签证只保存在本地选择状态，没有上传完整签证资料 |
| `android/app/src/main/java/com/yuanhe/layoverjoy/ui/OnboardingScreen.kt:160` | 护照上传异常被吞掉后仍可能完成 onboarding |

**影响**

系统可能把缺少有效期、次数或第二段确认信息的用户标为 `ELIGIBLE`。这是产品最核心的安全承诺，优先级高于 UI 优化。

**Qoder 动作**

搜索前只能给出 preliminary eligibility；第二段 Verify 完成后再做 booking eligibility。缺少签证有效期、入境次数、适用签证类型、护照有效期或 onward confirmation 时必须 `NEEDS_INFO`，不得 fail open。Onboarding 上传失败时不得静默完成。

**验收用例**

| 用例 | 期望 |
| --- | --- |
| 中国护照，无满足规则的签证 | 排除或 `INELIGIBLE` |
| 中国护照，签证类型匹配但无 expiry | `NEEDS_INFO` |
| 签证已过期 | `INELIGIBLE` |
| 第二段只 Search、未 Verify | 不得显示 booking-ready |
| 第二段 Verify 成功且所有硬条件满足 | 才允许 `ELIGIBLE_FOR_BOOKING` |

### P0-06 双订单 Saga 状态机不能正确处理部分成功

**证据**

| 位置 | 发现 |
| --- | --- |
| `backend/src/bookings/bookings.service.ts:138` | 航段按降序排序，实际先下 leg 2 |
| `backend/src/bookings/bookings.service.ts:141` | 只跟踪 `legAOrdered`，没有跟踪实际成功订单集合 |
| `backend/src/bookings/bookings.service.ts:145` | leg 2 成功时就可能进入 `BOTH_ORDERED`，尽管 leg 1 尚未创建 |
| `backend/src/bookings/bookings.service.ts:149` | 注入 leg 2 失败发生在任何订单成功之前，却记录 `PARTIAL_ORDER` 并提示第一段已创建 |
| `backend/src/bookings/bookings.service.ts:191` | leg 2 成功、leg 1 失败时，因 `legAOrdered=false` 可能错误进入人工处理分支 |
| `PRODUCT_DEFINITION.md:41` | 文档写 leg B first，但后续 Demo 描述又写 leg A 成功后 leg B 失败，互相矛盾 |

**影响**

系统可能展示不存在的订单、遗漏已成功订单的退款，或发出错误通知。

**Qoder 动作**

明确唯一订单顺序，并使用 `orderedLegs[]`、`paidLegs[]` 和 `refunds[]` 驱动状态，禁止以布尔值猜测。部分成功必须保留 booking intent ID，准确列出成功 provider order ID、失败航段和补偿结果。

**必须覆盖的测试**

| 场景 | 期望 |
| --- | --- |
| A 成功、B 失败 | A 模拟退款，状态与通知准确 |
| B 成功、A 失败 | B 模拟退款，状态与通知准确 |
| 两段下单成功、A 支付失败 | 不自动重试真实支付，按策略补偿或人工处理 |
| 两段均成功 | 只在两张订单和付款条件都满足后完成 |

### P0-07 Atlas Adapter 违反项目自己的 fixture gate

**证据**

| 位置 | 发现 |
| --- | --- |
| `AGENTS.md:46` | 明确要求没有真实脱敏 fixture 时不得猜测 Atlas DTO |
| `backend/src/providers/atlas/sandbox.provider.ts:20` | 注释承认尚未抓取 fixtures |
| `backend/src/providers/atlas/sandbox.provider.ts:106` | 已开始猜测请求体和多个可能的响应字段名 |
| `backend/package.json:20` | 没有 `atlas-flight-booking-skill` 依赖或 wrapper |
| 工程目录 | 未发现 Atlas Search/Verify 的真实脱敏 request/response fixture |

**影响**

代码看似接了 Sandbox，但 DTO 很可能在真实请求时返工，也无法证明使用了 Atlas 开源 Skill。

**Qoder 动作**

二选一并明确记录：

1. 优先包装 `atlas-flight-booking-skill` 的标准化 CLI/SDK 契约，后端只依赖其 normalized output。
2. 如果直接调用 ATRIP API，必须先保存真实脱敏 Search/Verify fixture，再按真实字段实现 DTO；不得保留“尝试多个可能字段名”的猜测式 parser。

Order/Pay/Refund 可继续 Mock，但 UI 必须明确显示 Sandbox Search/Verify 与模拟交易的边界。

### P0-08 乘机人姓名以明文 JSON 落库，和隐私声明冲突

**证据**

| 位置 | 发现 |
| --- | --- |
| `backend/src/bookings/bookings.service.ts:11` | 下单输入允许 given/family name |
| `backend/src/bookings/bookings.service.ts:86` | `passengers` 直接写入 `passengerJson`，没有调用字段加密服务 |
| `backend/prisma/schema.prisma` 的 `BookingIntent.passengerJson` | JSON 字段本身没有应用层加密保证 |
| `PRODUCT_DEFINITION.md:28` | 文档声称 MVP 不收集姓名，与实现不一致 |

**影响**

当前产品隐私承诺不真实。后续切换真实 Atlas Order 时还会缺少 DOB、性别、国籍、证件有效期等精确定义，容易临时扩大数据收集范围。

**Qoder 动作**

根据真实 Atlas Order fixture 定义最小 passenger DTO。Mock Demo 若不需要姓名，就删除姓名采集；真实 Sandbox 若要求姓名，只在确认页按需收集并加密存储或采用短期用途数据，明确保留期限。不得把姓名、邮箱或证件数据传入 Daytona/Nosana。

## 四、P1：影响完整体验与工程可信度的问题

### P1-01 航司、直飞/转机偏好没有打通

后端输入虽然有 airlines 字段，但 SearchOrchestrator 调 Atlas/Mock 时没有传递；Android SearchPreferences 与搜索页也没有允许/排除航司、仅直飞、允许转机等完整控件。

相关位置：`backend/src/search/search.service.ts:15`、`backend/src/search/search.orchestrator.ts:69`、`android/app/src/main/java/com/yuanhe/layoverjoy/data/Models.kt:122`。

Qoder 应把偏好从 UI、API DTO、搜索编排、Atlas provider 一直传到最终结果过滤，并在结果卡显示“为何符合偏好”。

### P1-02 监控规则没有执行 JoyScore 条件和通知渠道选择

`minJoyScore` 和 `notifyApp` 可被提交，但 `checkRule` 只检查价格；NotificationsService 无论用户是否开启 App 通知都会创建 APP delivery。没有 trigger edge、cooldown 或去重，目标价格持续满足时可能每轮重复发送。SMTP 未配置时，console-only 邮件仍被记录为 `SENT`。

相关位置：`backend/src/monitors/monitors.service.ts:10`、`:147`，`backend/src/notifications/notifications.service.ts:59`、`:75`。

Qoder 应重新计算当前候选 JoyScore、尊重 channel 开关、增加 cooldown/edge trigger，并区分 `SENT`、`SIMULATED`、`SKIPPED`、`FAILED`。文档中的 5 分钟频率与实际 30 分钟检查间隔也要统一。

### P1-03 Android 没有系统通知和 deep link 闭环

工程没有 WorkManager 依赖、`POST_NOTIFICATIONS` 权限和 deep-link intent filter。通知页点击只标记已读，未使用后端 `deepLink` 跳到方案或预订；行程页订单卡也没有恢复预订流程。

相关位置：`android/app/build.gradle.kts:52`、`android/app/src/main/AndroidManifest.xml:1`、`android/app/src/main/java/com/yuanhe/layoverjoy/ui/NotificationsScreen.kt:56`、`TripsScreen.kt:147`。

MVP 可用 WorkManager 15 分钟轮询加 Debug 立即触发按钮，不必接 Firebase，也不需要付费 Google Play 开发者账号。必须能从系统通知进入指定方案详情。

### P1-04 Android 登录没有使用 refresh token rotation

后端已实现 refresh rotation，Android 也声明了 refresh endpoint，但拦截器遇到 401 直接注销，不尝试刷新；logout 请求也没有携带 refresh token，后端无法撤销该会话。注册请求使用 `nickname`，后端期望 `displayName`，昵称会被忽略。

相关位置：`backend/src/auth/auth.service.ts:60`、`android/app/src/main/java/com/yuanhe/layoverjoy/data/Api.kt:29`、`:64`、`:84`。

Qoder 应实现并发安全的单次 refresh、失败后再登出，并统一字段名称。

### P1-05 每一段可以分别回退 Mock，但整条方案来源标签可能错误

SearchOrchestrator 允许 leg 1 或 leg 2 独立 fallback 到 Mock，但方案只取 leg 1 的 provider label。混合数据可能被整体展示成 `ATLAS_SANDBOX`。

相关位置：`backend/src/search/search.orchestrator.ts:164`、`:334`、`:380`。

Qoder 应保存 per-leg provider，聚合来源为 `ATLAS_SANDBOX`、`MOCK` 或 `MIXED`；任何一段为 Mock 时，不得把整个方案标为真实 Atlas。

### P1-06 搜索并发预算和硬超时不能真正停止后台任务

并发 worker 共享递增 `searchCalls`，没有原子预算预留，可能超过上限。`Promise.race` 到时只结束等待，不取消仍在运行的 candidate worker，它们可能在 search finalization 后继续写数据库。

相关位置：`backend/src/search/search.orchestrator.ts:94`、`:103`。

Qoder 应使用 semaphore/request-budget allocator 和 AbortSignal；超时后取消或等待 settlement，再一次性 finalize，避免完成后继续变更结果。

### P1-07 Webhook 缺少可靠重试和严格 CID 校验

`getOrder` 失败后事件被标为 `PROCESSED`，没有 retry pending、重试次数或退避任务；配置了 CID 时，如果请求完全不带 CID 仍可能被接受。

相关位置：`backend/src/webhooks/webhook.service.ts:44`、`:106`。

Qoder 应增加 `PROCESSING`、`RETRY_PENDING`、`PROCESSED`、`FAILED`，记录 retry count/next retry，使用指数退避，并严格遵循真实 Atlas webhook contract。真实签名方式未确认前保持 provider adapter，不得自创并声称官方签名算法。

### P1-08 数据库迁移、自动测试和真实 fixtures 缺失

`backend/prisma/` 只有 schema，没有 migrations；工程没有发现 `.spec.` 或 `.test.`；Docker 启动使用 `prisma db push`。现有 smoke script 对双订单失败的响应假设与服务逻辑不一致，不能作为验收证据。

Qoder 至少补齐 rule engine、JoyScore、双订单 Saga、provider parser 的单元测试，补 Search/Verify/Nosana 脱敏 fixtures，并使用正式 migration。任何“全链路已验证”的文档表述都必须由命令、时间、环境和输出摘要支撑。

### P1-09 文档存在实现状态和接口路径的过度声明

`PRODUCT_DEFINITION.md` 把部分未完成能力列为 shipped，且双订单顺序前后矛盾。`TECHNICAL_IMPLEMENTATION.md` 声称全链路 smoke 已验证、Preview Token 只在运行时输入，但与源码不符；文档还列出工程中不存在或路径不同的接口。

Qoder 应统一使用 `IMPLEMENTED`、`PARTIAL`、`PENDING_REAL_INTEGRATION`、`MOCK_ONLY` 四种状态。没有运行证据时不得写 `VERIFIED`。

### P1-10 BookingIntent 快照和乘机人边界定义不完整

BookingIntent 保存了 plan JSON，但缺少明确的 provider offer capturedAt、Verify 时间和 price-expiry 语义。乘机人数组可以为空，无法支撑真实 Order。

Qoder 应根据真实 fixture 固定：offer 捕获时间、Verify 时间、价格有效期、每段 routing/session identifier、passenger schema、加密边界和删除策略。

## 五、P2：可以在 P0/P1 之后处理

| 编号 | 问题 | 建议 |
| --- | --- | --- |
| P2-01 | Health API 把“环境变量存在”当作“集成健康” | 分离 configured、probed、lastSuccess 和 lastErrorCategory |
| P2-02 | 英文界面仍有中文城市包，Nosana system prompt 固定中文 | 按 `Accept-Language` 或用户语言生成并缓存双语内容 |
| P2-03 | Android 直接显示 `visaConfidence` 等技术 key | 后端返回稳定 label/description，App 使用可读文案 |
| P2-04 | 全成本已计算，但顶部核心比较仍偏重票价 | 同时展示机票增量与全成本增量，避免“便宜”误导 |
| P2-05 | 机场目录只覆盖固定 MVP 城市 | 文档明确范围，并提供可扩展 airport catalog；不要声称支持全球任意城市 |
| P2-06 | 候选 hub 固定取前三个，与路线相关性不足 | 按方向、航司网络、签证和可用航班逐步筛选 |
| P2-07 | 红眼航班和时间舒适度按 UTC 判断 | 使用机场 IANA timezone 转为当地时间后评分 |
| P2-08 | `ADMIN_DEBUG_TOKEN` 未配置 | 如需 Demo webhook 注入，使用运行时 Secret；不需要则关闭 debug endpoint |
| P2-09 | `allowBackup=true` 且 token 存 DataStore | 对凭据使用 no-backup/encrypted storage，至少关闭包含凭据的备份 |

## 六、需求完成度矩阵

| 需求 | 状态 | 审查结论 |
| --- | --- | --- |
| 产品名 LayoverJoy、包名 `com.yuanhe.layoverjoy` | 已实现 | Android 配置一致 |
| 注册、登录、资料、搜索、详情、监控、通知、预订页面 | 部分实现 | 页面基本齐全，但多个闭环未打通 |
| JWT、Argon2、refresh rotation 后端 | 部分实现 | 后端存在，Android refresh/logout 未闭环 |
| 最小旅行证件钱包 | 部分实现 | 护照路径存在，签证上传和失败处理不完整 |
| Visa-aware hard filter | 未达标 | 存在未 Verify 先确认和缺字段放行风险 |
| 直飞基线、双航段停留方案、全成本 | 部分实现 | 主体存在，来源聚合和时间语义需修复 |
| JoyScore | 部分实现 | 确定性评分存在，但时区和 UI 解释不足 |
| Atlas Sandbox Search/Verify | 无可验证证据 | Adapter 存在，真实 fixture 和 skill 契约缺失 |
| Atlas Order/Pay/Refund | Mock 实现 | 可以用于 Demo，但必须明确标识模拟 |
| Nosana 推理 | 部分实现 | 服务代码和在线部署存在，产品调用证据与配置职责缺失 |
| Daytona 后端运行 | 部分实现 | 有部署脚本/Preview URL；不能等同候选沙箱 Agent 执行 |
| Daytona 每候选隔离执行 | 未实现 | 沙箱只 echo，evaluate 在主进程 |
| 多规则价格/JoyScore 监控 | 部分实现 | 价格检查存在，JoyScore/channel/cooldown 缺失 |
| 邮件通知 | 部分实现 | SMTP 路径存在，模拟发送状态语义需修复 |
| Android 本地系统通知与 deep link | 未实现 | 只有 App 内通知列表 |
| 双订单 Saga 与模拟退款 | 未达标 | 核心状态机存在逻辑错误 |
| Webhook 幂等和 reconciliation | 部分实现 | 幂等基础存在，重试和 contract 尚不完整 |
| Docker 本地运行 | 基本实现 | Compose 架构存在，迁移与运行验收未提供 |
| 自动化测试、真实 fixtures、可复现证据 | 未实现 | 当前不足以支撑“全部完成” |
| Secret 管理 | 未达标 | Android 硬编码 Preview Token；Nosana 掩码被当配置 |

## 七、Qoder 建议执行顺序

请严格按下列顺序处理，避免先美化 UI、后返工核心契约：

1. 修复 P0-04 Secret 泄露，建立环境变量占位符检测。
2. 按第二章拆分 Nosana 管理 API 与推理 endpoint，接入 deployment ID，并产出真实脱敏推理 fixture。
3. 修复 Visa preliminary/verified 两阶段判定、签证上传和 fail-closed 行为。
4. 重写双订单 Saga，以实际成功订单集合驱动状态和补偿。
5. 让 Daytona sandbox 真正执行候选 evaluator，并把 App 搜索接到唯一 planning-job 主流程。
6. 选择 Atlas Skill wrapper 或真实 fixture 驱动的 direct adapter，禁止继续猜 DTO。
7. 修复乘机人数据最小化与加密边界。
8. 打通航司/直转偏好、监控 JoyScore/channel/cooldown、Android 系统通知和 deep link。
9. 补 migrations、单元测试、集成测试和 Demo evidence bundle。
10. 最后同步产品、技术和 Demo 文档，只声明能够提供证据的能力。

## 八、Qoder 最终提交物与验收门槛

Qoder 修复后，请在工程中新增不含 Secret/PII 的 `evidence/`，至少提供：

| 文件 | 内容 |
| --- | --- |
| `evidence/README.md` | 环境、日期、commit、运行命令、结果摘要、已知限制 |
| `evidence/nosana/request.sanitized.json` | 真实推理请求，不含用户身份和 Secret |
| `evidence/nosana/response.sanitized.json` | provider、deploymentId、model、latency、HTTP status、返回结构 |
| `evidence/daytona/job.sanitized.json` | job ID、候选 sandbox IDs、各自 evaluator 输出和 cleanup status |
| `evidence/atlas/search-request.sanitized.json` | 真实 Sandbox Search 请求 |
| `evidence/atlas/search-response.sanitized.json` | 真实 Search 响应关键字段，保留原始层级 |
| `evidence/atlas/verify-request.sanitized.json` | 真实 Verify 请求 |
| `evidence/atlas/verify-response.sanitized.json` | 真实 Verify 响应及 price/identifier 字段 |
| `evidence/tests/summary.md` | Rule、JoyScore、Saga、monitor、provider parser 测试结果 |
| `evidence/security/summary.md` | 源码/APK Secret 扫描、日志脱敏和 PII 边界结果 |

最终通过门槛：

1. 同一条 Android 搜索能够产生 direct baseline 和至少一个 visa-aware stopover plan。
2. 签证信息不完整时绝不显示 booking-ready；完成第二段 Verify 后才升级资格状态。
3. 至少两个候选在不同 Daytona sandbox 中真实执行 evaluator，并能证明清理结果。
4. 至少一次说明生成返回 `provider=NOSANA`，对应 deployment `...V9BfGw` 和 `qwen3.5:9b`，且有脱敏请求响应证据。
5. Atlas 真实 Search/Verify 有 fixture；若尚未成功，UI 必须清楚显示 Mock，不得伪装成 Sandbox。
6. 双订单两种单边失败顺序都能得到正确补偿状态和通知。
7. 监控同时支持 price 和 min JoyScore，尊重邮件/App channel，且不会每轮重复通知。
8. 系统通知可点击进入对应方案；无需 Firebase，也无需付费 Google Play 开发者账号。
9. Android 源码和 APK 不包含 Daytona、Atlas、SMTP、Nosana 管理 Key 或其他长期 Secret。
10. 所有 Demo 数据明确标记 Sandbox/Mock 边界，禁止真实扣款，也禁止将 PII 发送到 Daytona 或 Nosana。

## 九、已经做对、应当保留的实现

以下基础不建议推倒重来：

1. Android Compose 消费者 App 结构和 `com.yuanhe.layoverjoy` 包名。
2. 后端 JWT、Argon2、refresh rotation 的总体方向。
3. 确定性签证规则引擎与 LLM 解释层分离。
4. direct baseline、双航段 stopover、成本拆分和 JoyScore 的领域模型。
5. Atlas provider 的 Mock/Sandbox 分层和 Search cache、timeout、retry 基础。
6. Nosana 失败时使用模板回退，但必须明确标记 provider。
7. SMTP 接收地址取当前登录用户邮箱，而不是固定邮箱。
8. Mock Order/Pay/Refund 与 webhook 幂等、加密 provider identifier 的总体方向。
9. Docker Compose 的 API、Worker、PostgreSQL、Redis 分层。
10. 对 Daytona candidate input 去标识化，以及不把 LLM 用作签证最终裁决的安全原则。

修复目标不是扩大 MVP，而是让现有卖点变成**真实、可验证、失败时诚实降级**的完整链路。
