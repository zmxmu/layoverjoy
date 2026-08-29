# LayoverJoy Qoder 实现总指令

本文件是 Qoder 生成 LayoverJoy 工程时的最高优先级项目约束。将本目录作为输入时，先把本文件复制到生成仓库根目录，再开始生成代码。

## 1. 单一事实源优先级

发生冲突时按以下顺序执行：

1. AGENTS.md
2. 10-Qoder代码生成契约补全.md
3. 00-LayoverJoy-Qoder启动说明.md
4. 03-LayoverJoy-技术实现方案.md
5. 04-LayoverJoy-Qoder任务执行计划.md
6. 06-签证规则种子数据.md
7. 07-Atlas-Webhook与双订单补偿.md
8. 09-双黑客松适配与两分钟Demo.md
9. 其他历史章节

旧章节中的“仅本机 Docker”、旧包名和“Sandbox 真实市场价格”等表述全部失效。

## 2. 固定产品决策

- 产品名：LayoverJoy
- 中文口号：转机的乐趣
- Android applicationId：com.yuanhe.layoverjoy
- Android：Kotlin、Jetpack Compose、Material 3，应用内中英双语（默认中文）
- 双语实现：ui/i18n/L10n.kt 词典 + Compose 快照状态，切换即时生效不重启；语言切换入口在“我的”页
- 后端：NestJS、TypeScript
- 数据库：PostgreSQL
- 缓存与任务协调：Redis
- 本机运行：Docker Compose
- 远程开发与 Demo：Daytona
- AI 推理：Nosana
- 航班能力：Atlas/ATRIP Sandbox
- 邮件收件人：当前认证用户的 users.email
- 支付：Sandbox 或明确标识的模拟支付
- 不实现生产部署和真实信用卡支付

## 3. Atlas 数据真实性

- Atlas Sandbox 是模拟测试环境。
- Sandbox 价格是模拟价格，禁止描述成真实市场价格、真实低价或真实价格趋势。
- Sandbox 只保证官方测试路线，不承诺任意城市都有返回。
- Demo UI 必须显示“Atlas Sandbox 模拟报价”。
- 生产产品愿景可以描述为接入生产 Atlas 后使用实时可交易数据，但 Demo 不得冒充生产数据。
- 真实 Atlas 请求和响应 Fixture 未完成前，不得猜测原始 DTO 字段。
- P0 可以先包装 atlas-flight-booking-skill 的规范化 CLI 契约。
- 直连 ATRIP Adapter 必须等待脱敏抓包 Fixture。

## 4. 签证与证件安全

- 签证规则是确定性前置过滤，不由 LLM 决定。
- 任何结论必须带 ruleId、sourceUrl、checkedAt 和 confidence。
- App 必须提示最终决定属于航空公司和边境机关。
- MVP 不保存护照号码、签证号码和证件照片。
- Sandbox 输入不得包含姓名、邮箱、护照号码或签证号码。
- 日志不得记录旅行证件明文。

## 5. Secret 安全

- 不把任何真实 Key、Secret、密码、Token 写入源码、Markdown、Fixture、APK 或日志。
- 服务端 Secret 只从本机安全环境或 Daytona Secrets 注入。
- Android 只包含 API Base URL 和短期用户 JWT。
- 严禁把 .secrets 目录上传到 Daytona、Git 或制品。
- 示例值必须使用明显占位符。
- 错误响应不得回显外部服务请求头。

## 6. 外部服务 Adapter

每个外部服务都实现接口和至少两个 Provider：

- Atlas：mock 与 sandbox
- Nosana：mock 与 remote
- Daytona：local-runner 与 sandbox
- SMTP：console 与 smtp

Provider 由环境变量选择。外部服务不可用时返回可解释降级结果，不允许 LLM 伪造数据。

## 7. 搜索和规划约束

- 实时请求最多评估 3 个中转城市。
- 每个城市最多评估 2 个停留天数。
- 单次规划最多 10 个 Atlas Search 请求。
- Atlas Search 并发上限 3。
- 单请求超时默认 8 秒。
- 整体软超时 20 秒，硬超时 30 秒。
- 部分候选失败返回 PARTIAL。
- 只对用户最终选中的 Offer 执行 Verify。
- Search Cache 默认 15 分钟。
- Daytona 临时 Sandbox 在成功、失败和超时路径都必须清理。

## 8. 预订约束

- 多日 Stopover 由两张独立单程订单组成。
- Order 和 Pay 不自动重试。
- 第一张成功、第二张失败时进入 PARTIAL_BOOKING。
- MVP 补偿只执行明确标识的模拟退款或人工处理状态。
- 不承诺独立机票的联程保护。
- 每次价格上涨都需要用户重新确认。

## 9. UI 约束

- 以 ui-reference/flight-monitor-app-ui.html 为视觉和流程依据。
- 这是消费者 App，不得生成管理后台或桌面 Dashboard 风格。
- 必须走通注册、登录、证件设置、偏好、搜索、加载、结果、筛选证据、详情、监控、通知、乘机人确认、支付模拟、成功和行程。
- 钱包卡片文字必须横排，导航箭头保持轻量。
- 所有 Sandbox 价格都显示测试环境标签。
- Daytona 运行证据只展示结构化工具摘要，不展示模型思维链。
- 界面文案禁止硬编码单语字符串：一律走 L10n.t(key)；枚举类标签（漏斗状态、置信度、风险、证件类型）用 code→i18n key 映射，只向后端传 code。新增/修改 L10n.t 调用后必须运行 `bash scripts/check-i18n.sh`，确认所有 key 在中英字典中均已定义（缺失时 App 会把原始 key 直接显示给用户）。

## 9.1 项目文档约定

- project/PRODUCT_DEFINITION.md：英文产品定义（对外口径），变更产品范围时同步更新。
- project/TECHNICAL_IMPLEMENTATION.md：英文技术实现（架构/契约/部署），变更架构或部署方式时同步更新。
- project/AGENTS.md：本文件，生成约束最高优先级。

## 10. 数据模型约束

- MVP 每个用户只能有一本 ACTIVE 主护照。
- 用户可以有多条签证和居留许可。
- Flight Leg 使用从 1 开始的 legNo。
- 直飞方案有一个 Leg；Stopover 方案有两个有序 Leg。
- BookingIntent 保存完整不可变 planSnapshot、schemaVersion 和 capturedAt。
- 直飞基准字段名为 baselineDirectOfferSnapshotId，不与方案自身报价混用。

## 11. 完成门禁

代码可以在外部 Preflight 为 PENDING 时以 Mock Provider 生成，但不得宣称真实 Sandbox Demo 已完成。

真实 Demo 必须满足：

- Atlas 官方测试路线 Search 已通过。
- Atlas 脱敏 Search Fixture 已保存。
- Nosana真实 Endpoint 请求已通过并保存脱敏 Fixture。
- Daytona Sandbox Job 已真实运行。
- App 中 Sandbox 标识正确。
- 当前注册用户可以收到邮件。
- 本地 Docker 回退可启动。
