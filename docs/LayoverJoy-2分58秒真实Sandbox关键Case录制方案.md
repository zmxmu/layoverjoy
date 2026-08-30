# LayoverJoy 2 分 58 秒真实 Sandbox 关键 Case 录制方案

## 1. 目标

使用 Android 模拟器真实运行 LayoverJoy，录制一条不超过 2 分 58 秒的英文产品 Demo。视频必须同时证明：

- Visa-Aware Stopover Routing 是推荐前置条件，不是搜索后的普通提醒。
- Atlas 提供真实 Sandbox 航班搜索、核价、订单、支付和测试出票能力。
- AI 解读能解释城市停留价值、行程可行性、便利度和代价。
- 用户可以创建价格或 JoyScore 监控并收到通知。
- 所有 Sandbox、估算和本地规则数据均诚实标注。

## 2. 相比旧录制 Prompt 的必要更新

### 2.1 删除旧表述

删除：

```text
完成 Sandbox Verify、模拟 Order/Pay
```

替换为：

```text
完成 Atlas Sandbox Verify、Order、Pay 和测试出票，展示测试订单号、PNR 和票号。
```

只有在真实 Atlas Sandbox 能力检查和实际调用成功后才能使用该表述。

### 2.2 增加报价可预订性门槛

录制前必须把报价区分为：

```text
REFERENCE_ONLY
BOOKABLE
VERIFIED
PRICE_CHANGED
EXPIRED
UNAVAILABLE
```

只有 `BOOKABLE` 报价允许进入 Verify。只有 Verify 成功后的报价允许创建订单。

### 2.3 增加真实出票证据

付款成功页必须展示：

- `Atlas Sandbox` 标签。
- 测试订单号。
- 测试 PNR。
- 测试票号。
- `No real payment was charged` 提示。

不得写成生产出票或真实扣款。

### 2.4 增加双航段一致性检查

HKG → BKK → ZRH 必须满足：

- 第一段终点是 BKK。
- 第二段起点是 BKK。
- 两段日期符合 3 天停留。
- 两段来自同一个 SearchRun。
- 两段报价没有跨环境、跨搜索拼接。
- 直飞基准来自同一个 SearchRun。
- 两段都能核价后，才允许尝试双订单流程。

### 2.5 增加 Sandbox 路线可用性 Gate

录制前执行一次只读预检：

```text
HKG → BKK
BKK → ZRH
HKG → ZRH direct baseline
```

预检结果分为：

#### A. 两段均为 BOOKABLE

使用完整主线：

```text
HKG → BKK → ZRH
→ 双段 Verify
→ 双订单
→ Sandbox Pay
→ 测试出票
```

#### B. 能搜索但至少一段仅为 REFERENCE_ONLY

- HKG → BKK → ZRH 仍用于展示 Visa-Aware 产品价值。
- 不得对参考报价显示“可出票”。
- 出票部分切换为独立、明确标注的 `Atlas Sandbox booking proof`。
- 出票证明优先使用已验证的 NRT → KIX Sandbox 可预订报价。
- 转场字幕必须说明：`Booking proof using Atlas Sandbox bookable inventory.`
- 不得暗示 NRT → KIX 是前述曼谷停留方案的一部分。

#### C. 搜索本身不可用

- 不开始正式录制。
- 输出供应商错误、HTTP 状态、requestId 和失败步骤。
- 不用本地 Fixture 冒充实时 Atlas 数据。

## 3. 推荐 Demo 主线

### 3.1 用户画像

```text
Nationality: China
Passport: Ordinary passport
Valid visas: Based on the prepared Demo profile
Language: English
```

只使用虚构乘机人信息。不得将真实证件信息用于 Sandbox 下单。

### 3.2 产品 Case

```text
Origin: Hong Kong (HKG)
Final destination: Zurich (ZRH)
Stopover: Bangkok (BKK)
Stopover duration: 3 days
```

### 3.3 必须呈现的产品价值

- 用户证件条件参与中转地前置过滤。
- 显示检查了多少候选中转地、排除了多少个以及原因。
- 直飞与曼谷停留方案进行透明对比。
- 展示两段航班时间、停留窗口和总价格。
- 展示全成本或至少明确列出票价构成。
- 展示曼谷停留的优势、便利度、可执行微行程、获得与代价。
- 进入 Verify 前展示独立机票风险。
- Verify 后展示价格是否变化。
- 付款前要求确认准确金额。

## 4. 2 分 58 秒时间线

总长度目标：`176 至 178 秒`。

| 时间 | 场景 | 关键证明 |
| --- | --- | --- |
| 00:00–00:08 | 启动画面与登录 | 正式用户流程，无演示账户捷径 |
| 00:08–00:20 | 旅行证件钱包 | 中国普通护照、签证条件已设置 |
| 00:20–00:40 | 搜索设置 | HKG、ZRH、3 天停留、日期和偏好 |
| 00:40–00:52 | Visa-Aware Agent 过程 | 候选城市、签证排除、Atlas 搜索 |
| 00:52–01:15 | 结果与对比 | 直飞基准、曼谷 3 天、价格差、JoyScore |
| 01:15–01:43 | 方案详情与 AI 解读 | 城市价值、便利度、微行程、收益与代价 |
| 01:43–01:53 | 创建监控 | 目标价格或最低 JoyScore |
| 01:53–02:10 | Verify 与准确金额确认 | 报价状态、价格变化、独立机票风险 |
| 02:10–02:34 | Sandbox Order/Pay/Ticket | 测试订单、PNR、票号、无真实扣款 |
| 02:34–02:48 | 通知 | 监控触发一次 App Notification |
| 02:48–02:58 | 结束页 | LayoverJoy 核心价值和技术标识 |

若采用 NRT → KIX 独立出票证明，控制转场及出票证明在 25 秒内。

## 5. 分镜文件策略

不要直接录制唯一一个 178 秒长文件。每个关键场景保存为独立文件：

```text
submission/runtime-demo/clips/
01-login-profile.mp4
02-search.mp4
03-visa-routing.mp4
04-results.mp4
05-ai-detail.mp4
06-monitor.mp4
07-verify.mp4
08-order-pay-ticket.mp4
09-notification.mp4
10-ending.mp4
```

英文旁白也按相同编号独立保存：

```text
submission/runtime-demo/audio/
01-login-profile.mp3
02-search.mp3
...
10-ending.mp3
```

字幕按场景保存为独立 SRT，最后再合并：

```text
submission/runtime-demo/subtitles/
01-login-profile.srt
...
10-ending.srt
```

最终输出：

```text
submission/runtime-demo/LayoverJoy-Demo-2m58s.mp4
submission/runtime-demo/LayoverJoy-Demo-2m58s-en.srt
```

需要替换某个页面时，只重录对应片段，不重新录制全部流程。

## 6. 录制前真实能力检查

### 6.1 后端

检查并记录：

```text
GET /v1/health
GET /v1/integrations
```

Atlas 状态至少应包括：

```text
authorization = ACTIVE
search = AVAILABLE
verify = AVAILABLE
order = AVAILABLE
payment = AVAILABLE
ticketing = AVAILABLE
environment = SANDBOX
```

如果接口只显示 `configured=true`，不能据此认定出票可用，必须执行 Atlas 官方状态检查。

### 6.2 报价与环境

- 环境切换后必须重新 Search。
- 不复用旧 `bookingReference`。
- 不复用已经支付的报价。
- 每次正式重录订单片段都创建新的 SearchRun 和 Verify。
- 搜索、核价、订单、支付日志必须带同一个内部 `correlationId`。

### 6.3 双订单

如果完整 Demo 对两张独立机票下单：

- 第一段和第二段分别 Verify。
- 两段核价都成功后才进入订单创建。
- 展示两张订单的准确总额。
- 第一张成功、第二张失败时进入 `PARTIALLY_BOOKED`。
- Sandbox 支持取消时尝试补偿取消。
- 不支持取消时执行明确标注的模拟退款或人工处理状态。
- 不得把部分成功显示为完整出票成功。

## 7. 录制数据重置

重置脚本只能重置 LayoverJoy 本地 Demo 数据，不能假装删除 Atlas 已创建的 Sandbox 订单。

建议命令：

```text
./scripts/reset-demo-state.sh --profile video --preserve-external-orders
```

重置内容：

- Demo 用户的本地 SearchRun。
- 本地方案、通知和监控规则。
- 本地 BookingIntent 和 UI 状态。
- AI 推荐缓存。

不能重置：

- Atlas Sandbox 已创建订单。
- 已生成的测试 PNR/票号。

每次录制使用唯一虚构乘机人后缀或内部 Demo Run ID，方便识别测试订单。

## 8. UI 与文案约束

- 所有录制页面使用英文。
- 不出现中英文混排。
- 不展示“Use demo account”。
- 不展示真实 Access Key、Secret、JWT、邮箱密码或证件号码。
- App UI 不显示 Nosana、模型名、GPU、Deployment ID 或推理耗时。
- 技术信息只能在 `BuildConfig.DEBUG` 下通过 `Log.d` 输出。
- `Atlas Sandbox` 必须可见。
- 付款页必须出现 `No real payment will be charged`。
- 出票页必须使用 `Test PNR` 和 `Test ticket number`。
- AI 不可用时使用相同结构的 RichTemplateNarrator，不改变页面布局。
- 详情页的可玩时间只出现一次。
- 不重复解释 JoyScore 定义。

## 9. 自动化与录屏要求

- 使用本机 Android 模拟器和 `adb` 实际操作。
- 所有关键控件提供稳定的 Compose `contentDescription` 或 testTag。
- 自动化优先使用 testTag，不依赖屏幕绝对坐标。
- 每个片段录制前恢复到明确页面状态。
- 点击后等待具体 UI 状态，不使用固定长时间 sleep 作为唯一同步方式。
- 录屏前关闭通知之外的随机系统弹窗。
- 录制过程不得打开开发者菜单、Logcat、终端或后端管理页面。
- 最终视频不得加速到难以阅读。
- 字幕和语音内容必须一致。
- 英文语音响度统一，避免单个片段明显过小。

## 10. 验收清单

- 最终时长不超过 2:58。
- App 全程英文。
- 登录、证件、搜索、结果、详情、监控、Verify、Order、Pay、Ticket、通知均可见。
- HKG → BKK → ZRH 航段连续且日期合理。
- 直飞和停留方案来自同一 SearchRun。
- AI 解读为丰富 v2 结构。
- 没有 KUL、SIN 或其他错误城市串入曼谷方案。
- 没有把参考报价作为可出票报价。
- 没有把 Sandbox 说成生产支付。
- PNR 和票号来自实际 Sandbox 响应，而非前端硬编码。
- 监控只触发一次通知。
- 各片段、旁白、字幕和最终视频均可独立找到。

## 11. 给 Qoder 的执行 Prompt

```text
请为 LayoverJoy 的 2 分 58 秒英文 Demo 完成真实运行预检、必要修复、自动化操作和分镜录制。

项目目录：
/Users/zhengmin/Documents/黑客松/alibaba/project

必须阅读：
/Users/zhengmin/Documents/黑客松/alibaba/project/docs/LayoverJoy-2分58秒真实Sandbox关键Case录制方案.md
/Users/zhengmin/Documents/黑客松/alibaba/qoder-input/14-LayoverJoy-AI中转价值解读产品实现方案.md
/Users/zhengmin/Documents/黑客松/alibaba/Atlas_Flight_Booking_Skill_Qoder_操作指南.docx

目标：
使用本机 Android 模拟器真实操作 LayoverJoy，录制一条 176 至 178 秒的英文 Demo。不要使用静态 HTML 原型冒充 App，也不要使用 Fixture 冒充实时 Atlas 响应。

主 Case：
- 正式用户登录，不展示“Use demo account”。
- 中国普通护照用户。
- 搜索 HKG → ZRH。
- 推荐经 BKK 停留 3 天。
- 展示 Visa-Aware 候选过滤。
- 展示直飞基准和曼谷停留方案。
- 打开方案详情并展示 Rich AI Stopover Insight v2。
- 创建价格或最低 JoyScore 监控。
- 完成 Atlas Sandbox Verify、Order、Pay 和测试出票。
- 展示测试订单号、Test PNR 和 Test ticket number。
- 展示一次 App Notification。

第一阶段：只读预检，不创建订单

1. 检查后端、数据库、Redis、Android 模拟器和 adb。
2. 检查 Atlas 官方 authorization、search、verify、order、payment、ticketing 状态。
3. 不得用 configured=true 代替真实能力检查。
4. 实测 HKG → BKK、BKK → ZRH、HKG → ZRH 直飞基准。
5. 确认两段是否均为 BOOKABLE。
6. 确认报价来自同一个 SearchRun，航段、日期、币种和停留窗口一致。
7. 检查所有录制页面是否完全英文。
8. 检查 AI v2、通知、Demo 重置和 Compose testTag。

完成预检后输出 Gate 结果：

- GATE_A：两段均 BOOKABLE，可以完整双段 Sandbox 出票。
- GATE_B：产品方案可搜索，但至少一段仅为 REFERENCE_ONLY；使用 HKG → BKK → ZRH 展示产品价值，并使用 NRT → KIX 作为独立 Atlas Sandbox booking proof。
- GATE_C：Atlas 搜索不可用；停止录制并报告真实错误。

不得在 GATE 未明确前创建订单或开始正式录制。

第二阶段：必要修复

只修复会阻塞录制的问题：

1. HKG → BKK → ZRH 航段组合错误。
2. 直飞、双段报价或 JoyScore 跨 SearchRun。
3. REFERENCE_ONLY 报价错误显示为可预订。
4. Verify 前未检查报价过期。
5. 价格变化后没有再次确认。
6. Sandbox Order、Pay、Ticketing 结果没有持久化或展示。
7. PNR 或票号是硬编码。
8. 详情页 AI v2 缺失、重复或中英文混排。
9. 监控重复触发通知。
10. 自动化控件缺少稳定 testTag/contentDescription。
11. Demo 状态不能一条命令恢复。

不得重构无关模块，不得修改签证 fail-closed 边界，不得向 Nosana 发送 PII。

第三阶段：实际 Sandbox 录制

1. 使用虚构乘机人资料。
2. 每次订单录制使用新的 SearchRun、bookingReference 和 Verify。
3. 不复用已支付报价。
4. 付款前展示准确金额、币种、价格变化和独立机票风险。
5. 由自动化点击明确确认按钮。
6. 展示 Atlas Sandbox、No real payment was charged、Test PNR 和 Test ticket number。
7. 如果执行双订单，第一张成功、第二张失败时不得显示完整成功。
8. 如果使用 NRT → KIX 独立出票证明，必须显示英文转场：Booking proof using Atlas Sandbox bookable inventory.

第四阶段：分镜文件

分别录制：

submission/runtime-demo/clips/01-login-profile.mp4
submission/runtime-demo/clips/02-search.mp4
submission/runtime-demo/clips/03-visa-routing.mp4
submission/runtime-demo/clips/04-results.mp4
submission/runtime-demo/clips/05-ai-detail.mp4
submission/runtime-demo/clips/06-monitor.mp4
submission/runtime-demo/clips/07-verify.mp4
submission/runtime-demo/clips/08-order-pay-ticket.mp4
submission/runtime-demo/clips/09-notification.mp4
submission/runtime-demo/clips/10-ending.mp4

旁白和字幕也必须按相同编号独立保存。不要只生成一个无法局部替换的长视频。

最终输出：

submission/runtime-demo/LayoverJoy-Demo-2m58s.mp4
submission/runtime-demo/LayoverJoy-Demo-2m58s-en.srt

最终视频要求：

- 176 至 178 秒。
- 真实模拟器运行画面。
- 全英文。
- 英文旁白音量一致。
- 字幕与旁白一致。
- 不显示终端、Logcat、密钥、模型名、Nosana、GPU 或 Deployment ID。
- 不把 Sandbox 表述为真实扣款或生产出票。

完成后汇报：

1. Atlas 能力检查结果。
2. 最终使用 GATE_A、GATE_B 还是 GATE_C。
3. Demo 数据重置命令。
4. 后端启动和 APK 安装命令。
5. 自动化脚本路径。
6. HKG → BKK → ZRH 实际数据摘要。
7. SearchRun、报价状态和 Verify 结果。
8. Order、Pay、Test PNR 和 Test ticket number 结果。
9. AI v2 实际返回摘要。
10. 监控和通知结果。
11. 所有分镜、音频、字幕和最终视频路径。
12. 已修复问题。
13. 仍可能影响无人录制的问题。
```
