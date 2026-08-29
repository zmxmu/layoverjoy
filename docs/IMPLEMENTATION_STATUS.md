# LayoverJoy — Qoder 构建记录

> 维护规范：`qoder-input/04-LayoverJoy-Qoder任务执行计划.md` §2。
> 每个 Task 记录状态、完成时间、修改文件、验收结果、测试命令与结果、已知限制。
> 记录中不得出现任何 Key、Token、密码或真实证件信息。

## HOME-P0 首页升级为 Visa-Aware 决策入口

- 状态：DONE
- 完成时间：2026-08-29T22:35:00+08:00
- Prompt 摘要：把首页从可点击漏斗升级为 Visa-Aware 决策入口。依据
  `qoder-input/11-LayoverJoy-首页核心产品改进执行方案.md`，只实现「我的最佳中转机会」卡：
  后端新增只读机会接口（只读本地已落库数据，不调用外部 Provider），Android 首页新增机会卡
  并覆盖 加载中/缺证件/空/就绪/过期/网络失败 全部状态，删除 Agent 静态动态与底部重复 CTA，
  补齐 17 个中英双语文案 key。
- 修改文件：
  - `backend/src/home/home.types.ts`（新增：契约类型）
  - `backend/src/home/home.service.ts`（新增：选择算法与状态机）
  - `backend/src/home/home.controller.ts`（新增：`GET /v1/home/opportunity`，JwtAuthGuard）
  - `backend/src/home/home.module.ts`（新增）
  - `backend/src/app.module.ts`（注册 HomeModule）
  - `android/.../data/Api.kt`（新增 `homeOpportunity()`）
  - `android/.../data/Models.kt`（新增 4 个机会卡模型，金额全部可空）
  - `android/.../ui/screens/HomeScreen.kt`（重写：机会卡全状态渲染、三路并行加载、删除 Agent 动态与底部 CTA）
  - `android/.../ui/i18n/L10n.kt`（新增 17 个 opportunity/provider key，删除废弃 key）
  - `docs/IMPLEMENTATION_STATUS.md`（新增：本记录）
  - `docs/screenshots/home-opportunity-en.png`（新增：英文首页机会卡截图）
- 验收结果：
  - 接口状态机实测（本地 Docker 后端）：
    - 无主护照 → `NEEDS_DOCUMENT` ✓
    - 有护照、无合格搜索 → `EMPTY`（含 profile）✓
    - 真实搜索完成后 → `READY`：eligibleHubCount=3（ELIGIBLE 快照按 cityId 去重）、
      选中 joyScore=93 的 KUL 方案、airfareDelta=-9.09（DIRECT_BASELINE 存在）、
      estimatedTripTotal 只读 costBreakdown、quoteFreshness=CURRENT、
      sourceProvider=ATLAS_SANDBOX 且 isSimulated=true ✓
  - 人工验收（模拟器装机，英文界面）：READY 卡渲染路线 SIN–KUL–SHA、2-day stay 胶囊、
    「Eligible under current rule」+「Atlas Sandbox」标签、金额与天数与接口一致；
    点击「View this plan」正确进入方案详情页；未登录时不重复渲染卡片（沿用游客引导）。
  - 截图：`docs/screenshots/home-opportunity-en.png`
- 测试命令：
  - `npx tsc --noEmit -p tsconfig.json`（backend）
  - `npx vitest run`（backend）
  - `bash scripts/check-i18n.sh`
  - `cd android && ./gradlew assembleDebug --console=plain`
- 测试结果：
  - tsc：EXIT 0，无错误
  - vitest：14/14 通过
  - check-i18n：265 keys，0 缺失
  - Gradle：BUILD SUCCESSFUL，APK 装机验证通过
- 已知限制：
  - 机会接口只读本地已落库数据，不触发新搜索；无搜索记录时展示 EMPTY 引导。
  - Atlas Sandbox 无库存的中转地不产生方案（funnel 标记 NO_SANDBOX_INVENTORY），
    不影响已生成方案的展示。
  - 报价无过期时间时 freshness=UNKNOWN，UI 不显示「实时」类措辞。
- 下一任务：无（按 11 号方案 §10 停止条件，完成即止）。

## NOSANA-LIVE：真实 GPU 推理接入与英文内容全英文化（2026-08-29）

- 状态：DONE
- 背景：详情页解释区此前因 `NOSANA_OPENAI_BASE_URL` 未配置而走模板降级；英文界面下城市体验包仍为中文。
- 改动：
  - `docker-compose.yml`：api 注入 Nosana 部署默认值（endpoint / deployment id / model，均非密凭据；可被环境变量覆盖）。
  - `backend/src/explanations/nosana.service.ts`：解释请求支持 `lang`（zh/en，双语 prompt 与双语模板）；按 09 文档约定失败最多重试一次（仅解析/网络类错误，整体 deadline 封顶）再降级模板；结果携带 `lang` 供缓存按语言失效。
  - `backend/src/plans/*`：`GET /v1/plans/:id` 与 `POST/GET /v1/plans/:id/explanation` 接受 `?lang=`；城市体验包按语言返回（`airportToCityZh` 键更名为 `airportToCity`）；NOSANA 缓存行语言不一致时重新生成。
  - `backend/src/airports/catalog.ts`：5 个城市体验包补英文内容。
  - Android：`planDetail`/`createExplanation` 透传 `L10n.current.tag`；详情页语言切换自动重载并按需重生成解释。
- 验证：
  - 部署 61xya…BfGw 初次实测在线但推理退化（content 空、reasoning 退化）→ 管理页重启后恢复。
  - 真实推理实测：provider=NOSANA，model qwen3.5:9b，latency 44–49s，deployment tail Y5V9BfGw；en/zh 双语输出均实测。
  - 间歇空内容场景：attempt 1 PARSE_ERROR → 重试；持续失败诚实降级 TEMPLATE 并标注原因。
  - 模拟器英文详情页全英文截图：`docs/screenshots/plan-detail-nosana-en.png`（含 Nosana 归属标注）。
- 测试：tsc EXIT 0；vitest 14/14；check-i18n 265 keys 0 缺失；Gradle BUILD SUCCESSFUL 装机验证。
- 已知限制：Nosana 为共享 GPU 节点，冷启动/繁忙时单次推理可达 40–60s，偶发空内容；总预算 NOSANA_TIMEOUT_MS=90s，超限诚实降级模板。
