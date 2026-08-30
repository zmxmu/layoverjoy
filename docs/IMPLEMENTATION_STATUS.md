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
  - 真实推理实测：provider=NOSANA，model qwen3.5:9b，deployment tail Y5V9BfGw；en/zh 双语输出均实测。
  - 提速：OpenAI 兼容接口无法关闭 qwen3.5 长推理（45–50s）；改走 Ollama 原生 `/api/chat` + `think:false` + `format:json`，实测 3.8–4.5s（10 倍）。
  - 间歇空内容场景：attempt 1 PARSE_ERROR → 重试；持续失败诚实降级 TEMPLATE 并标注原因。
  - 模拟器英文详情页全英文截图：`docs/screenshots/plan-detail-nosana-en.png`（含 Nosana 归属标注）。
- 测试：tsc EXIT 0；vitest 14/14；check-i18n 265 keys 0 缺失；Gradle BUILD SUCCESSFUL 装机验证。
- 已知限制：Nosana 为共享 GPU 节点，冷启动/繁忙时偶发空内容；总预算 NOSANA_TIMEOUT_MS=90s，超限诚实降级模板。解释落库缓存，重复展示瞬时。

## NOSANA-FAST：轻量模型换装（2026-08-30，演示前）

- 目标：解释生成 <2s。旧 qwen3.5:9b 即关思考也需 3.8–4.5s。
- 新部署：DfQoerNYzsD3PSqngPKX1P7BffHU9k2i6oc3XW5811vR，Qwen2.5-3B-Instruct-AWQ（served name `layoverjoy-qwen2.5-3b`），RTX 3060，$0.048/h。
- 后端适配：
  - 接口风格自适应：Ollama 原生 /api/chat 优先（qwen3 系关思考）；vLLM 等非 Ollama 栈（404/405）自动切 OpenAI 兼容 /v1。
  - 事实纪律：票价差文案（savings）由后端确定性计算并随 prompt 下发，模型逐字引用，杜绝 3B 改写货币/数值（实测曾把 SGD 写成“美元”/“$”）。
  - 输出压缩：summary ≤30 词/45 字、highlights 1、tips 1，压低生成 token。
- 实测：en 3.8s、zh 6.3s（含 ~1s 网络固定开销；3060 实测 ~25 tok/s）。
- 结论：3060 档稳态 en≈3–4s；<2s 需更高 GPU 档位（带宽约 2–3 倍）或依赖落库缓存（展示瞬时，仅 Regenerate 付费等待）。演示视频建议录缓存展示或接受 ~4s Regenerate。
- 坑：shell 中 export 的旧 NOSANA_* 会经 compose `${VAR:-default}` 覆盖 env_file——重建容器前必须 unset（本次曾因此注入旧端点致 503）。
- 截图：`docs/screenshots/plan-detail-nosana-en.png`（3.8s 版本）。

## NOSANA-FACTGUARD：金额移出 AI 职责 + 输出校验（2026-08-30）

- 问题：3B 模型收到「逐字引用 savings」指令仍把 SGD 改写成 `$134.17`（曼谷详情页实测）。
- 彻底方案：
  - 金额/货币完全移出 AI 职责：prompt 禁止提及价格/金额/货币（UI JoyCard 已确定性展示票价差）；userPrompt 不再下发 savings。
  - 输出校验兜底（09 文档 Zod 校验约定）：summary/highlights/tips 命中 `$|USD|SGD|dollar|美元|美金|欧元|€|¥|元` 判 VALIDATION_ERROR，带 STRICT REMINDER 重试一次，仍失败诚实降级模板。
  - 顺带修正错误分类：'invalid explanation payload' 归 PARSE_ERROR 而非 NETWORK_ERROR。
- 城市体验包标签更诚实：`人工精选 · 非实时库存` / `Curated · not live inventory`（回应“是否 mock”：人工维护的真实城市建议，非实时酒店库存）。
- 验证：BKK/KUL × zh/en 四条重生成全部 provider=NOSANA、零金额表述、2.7–6s；真机当场生成 5.3s 干净输出。
- 截图：`docs/screenshots/plan-detail-nosana-en.png`。
