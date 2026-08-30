# LayoverJoy Qwen2.5-1.5B 流式 AI 实施任务

## 1. 任务目标

把 LayoverJoy 的 AI 中转价值解读从“等待完整结果后一次性显示”升级为“立即展示分析进度，并流式呈现内容”，同时将 Nosana 推理模型切换为更适合 RTX 3060 低延迟演示的：

`Qwen/Qwen2.5-1.5B-Instruct-AWQ`

本任务必须保留现有 Rich AI Stopover Insight v2 的信息密度、签证安全边界和模板降级能力。不得把模型隐藏思维链展示给用户，也不得为了流式效果降低事实准确性。

项目目录：

`/Users/zhengmin/Documents/黑客松/alibaba/project`

Android 包名：

`com.yuanhe.layoverjoy`

## 2. Nosana 新部署约定

新部署名称必须明确体现模型版本：

`layoverjoy-qwen2-5-1-5b-stream`

模型：

`Qwen/Qwen2.5-1.5B-Instruct-AWQ`

建议推理配置：

| 配置项 | 值 |
| --- | --- |
| GPU | RTX 3060 或同等级 12 GB GPU |
| Quantization | AWQ；Ampere 环境优先 AWQ Marlin |
| Max model length | 4096 |
| GPU memory utilization | 0.90 |
| Max concurrent sequences | 1 |
| Temperature | 0.2 |
| Top P | 0.8 |
| Max output tokens | 480 |
| API 协议 | OpenAI-compatible Chat Completions |

已创建的 Nosana 部署：

| 项目 | 实际值 |
| --- | --- |
| Deployment name | `layoverjoy-qwen2-5-1-5b-stream` |
| Deployment ID | `5XksocRPS2cPrjRittPfGxFNUDxJobfDCcr5Ax9EZR1e` |
| Endpoint | `https://2F4cK5iT3Kngu4ayvM4ETKBq153chTkG7Xa7sASMg4jM.node.k8s.prd.nos.ci` |
| OpenAI models API | `https://2F4cK5iT3Kngu4ayvM4ETKBq153chTkG7Xa7sASMg4jM.node.k8s.prd.nos.ci/v1/models` |
| Chat Completions API | `https://2F4cK5iT3Kngu4ayvM4ETKBq153chTkG7Xa7sASMg4jM.node.k8s.prd.nos.ci/v1/chat/completions` |
| Served model name | `layoverjoy-qwen2.5-1.5b` |
| Hugging Face model | `Qwen/Qwen2.5-1.5B-Instruct-AWQ` |
| GPU | `NVIDIA 3060` |
| Nosana 状态 | `RUNNING`，Endpoint `ACTIVE` |
| 费率 | `$0.048/h` |
| Deployment strategy | `simple extend` |
| Container timeout | `2h`；该值不是整个 Deployment 的自动停止时间 |

新部署验证通过前，不得删除或覆盖当前 3B 部署配置。不使用时必须在 Nosana 页面手动执行 `Stop Deployment`，否则 `simple extend` 会继续续接 Job 并产生费用。

## 3. 用户体验目标

用户打开方案详情后，不需要点击“生成”按钮。界面应立即进入分析状态，并依次展示以下产品化进度，不展示模型思维链：

1. `Checking visa eligibility...`
2. `Comparing flight timing and total cost...`
3. `Building your 3-day Bangkok plan...`
4. `Finalizing the recommendation...`

收到正文后，以稳定、易读的方式逐步显示各内容区块。不要逐字符抖动刷新整个 Compose 页面；应按文本增量追加，必要时以 20 至 40 毫秒节奏做轻量打字机展示。

完成后的内容必须保持 Rich AI Stopover Insight v2 结构：

- `cityAdvantages`：为什么该中转城市值得停留。
- `interestMatch`：与用户兴趣的匹配点。
- `scheduleFit`：起降时间、净体验窗口和节奏是否合理。
- `miniItinerary`：可执行的精简行程。
- `convenienceScore` 与 `convenienceReasons`：转机便利度及依据。
- `travelerGains`：用户获得什么。
- `travelerAccepts`：用户必须接受的成本、风险或不便。

净体验窗口只显示一次。不得重复停留天数、JoyScore 定义或相同结论。

## 4. 后端流式协议

### 4.1 保留兼容接口

保留当前非流式 AI 接口，避免影响已有客户端和降级流程。新增独立流式接口，例如：

```http
GET /api/v1/plans/{planId}/ai-insight/stream?language=en
Accept: text/event-stream
Authorization: Bearer <jwt>
```

返回头至少包括：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### 4.2 SSE 事件定义

统一使用以下事件，不允许 Android 端解析未经定义的临时格式：

```text
event: status
data: {"stage":"CHECKING_VISA","message":"Checking visa eligibility..."}

event: section_start
data: {"section":"cityAdvantages"}

event: delta
data: {"section":"cityAdvantages","text":"Bangkok adds..."}

event: section_complete
data: {"section":"cityAdvantages"}

event: done
data: {"source":"NOSANA","schemaVersion":"rich-insight-v2"}
```

失败时：

```text
event: error
data: {"code":"AI_STREAM_UNAVAILABLE","recoverable":true}
```

### 4.3 Nosana 请求

调用 OpenAI-compatible `/v1/chat/completions`，核心参数：

```json
{
  "model": "Qwen/Qwen2.5-1.5B-Instruct-AWQ",
  "stream": true,
  "temperature": 0.2,
  "top_p": 0.8,
  "max_tokens": 480
}
```

必须正确处理 SSE 的 `data:` 行、空行、`[DONE]`、UTF-8 分片、连接中断和不完整 JSON。服务端在客户端断开后必须取消上游请求，避免继续消耗 GPU。

## 5. 输出格式策略

不要要求小模型流式生成一个直到最后才闭合的大型 JSON 对象。优先使用“逐区块 NDJSON”协议，每一行是一个可独立解析的完整对象：

```json
{"section":"cityAdvantages","text":"..."}
{"section":"interestMatch","text":"..."}
{"section":"scheduleFit","text":"..."}
{"section":"miniItinerary","items":["...","..."]}
{"section":"convenience","score":88,"reasons":["...","..."]}
{"section":"travelerGains","items":["...","..."]}
{"section":"travelerAccepts","items":["...","..."]}
```

后端按换行缓冲并校验每个完整对象，再转换成规范 SSE 事件。模型输出不得直接透传到 UI。字段缺失、字段类型错误或内容违反事实约束时，使用本地事实生成对应区块，不得将损坏 JSON 展示给用户。

## 6. Prompt 与事实边界

System Prompt 必须明确：

- 只能使用后端提供的结构化事实，不得自行编造航班、票价、签证、行李、机场交通或开放时间。
- 签证结论来自本地资格规则引擎；AI 只能解释，不能重新裁决。
- 不得输出分析过程、隐藏推理或内部模型说明。
- 每个 section 只输出一次，语言由 `language` 参数决定。
- 内容要简洁但有决策价值，避免营销空话。
- 当事实不足时明确使用保守表达，不得补造细节。

发送给 Nosana 的数据必须去除姓名、邮箱、护照号、生日、证件图片、JWT 和其他 PII。只允许发送匿名化旅行事实，例如国籍代码、签证资格结论、城市、日期、航班时间、价格拆分、兴趣标签和评分子项。

## 7. Android 实现要求

使用 OkHttp SSE 或基于 OkHttp 的可靠流式实现，不要用 Retrofit 普通 JSON Converter 直接读取无限流。ViewModel 状态至少包括：

```kotlin
sealed interface AiInsightStreamState {
    data object Idle : AiInsightStreamState
    data object Connecting : AiInsightStreamState
    data class Analyzing(val stage: String, val message: String) : AiInsightStreamState
    data class Streaming(val content: RichInsightV2Draft) : AiInsightStreamState
    data class Completed(val content: RichInsightV2) : AiInsightStreamState
    data class Fallback(val content: RichInsightV2) : AiInsightStreamState
    data class Failed(val recoverable: Boolean) : AiInsightStreamState
}
```

实现要求：

- 进入详情页自动连接，页面退出时取消连接。
- 旋转屏幕或 Compose 重组不得重复创建请求。
- 已完整缓存的内容直接显示，不重复调用模型。
- 断线只允许对“尚未收到任何正文”的请求自动重试一次。
- 已收到部分正文后断线，转入 RichTemplateNarrator 补全，不把半截句子作为最终答案。
- UI 不显示 Nosana、模型名称、GPU、Deployment ID、推理耗时或供应商名称。
- 技术信息只允许在 `BuildConfig.DEBUG` 保护的 `Log.d` 中输出。

## 8. 缓存、超时与降级

缓存键：

`planId + language + promptVersion + factsHash`

建议策略：

| 项目 | 要求 |
| --- | --- |
| 首个 `status` | 后端建立连接后立即发送，目标小于 100 ms |
| 暖机首 token | 目标小于 3 秒 |
| 首 token 超时 | 8 秒 |
| 总生成超时 | 20 秒 |
| 首 token 超时处理 | 立即切换 RichTemplateNarrator，并以 SSE 完成同结构内容 |
| 上游中断 | 取消 Nosana 请求，释放连接与资源 |

降级结果必须保持与 AI 结果相同的数据结构和 UI，不得出现空白卡片、无限 Loading 或要求用户手动重试才能继续 Demo。

## 9. 环境变量与切换

新增或确认以下配置，但不得把真实 Secret 提交到 Git：

```dotenv
NOSANA_AI_ENABLED=true
NOSANA_STREAMING_ENABLED=true
NOSANA_ENDPOINT=https://2F4cK5iT3Kngu4ayvM4ETKBq153chTkG7Xa7sASMg4jM.node.k8s.prd.nos.ci
NOSANA_MODEL=Qwen/Qwen2.5-1.5B-Instruct-AWQ
NOSANA_SERVED_MODEL=layoverjoy-qwen2.5-1.5b
NOSANA_DEPLOYMENT_ID=5XksocRPS2cPrjRittPfGxFNUDxJobfDCcr5Ax9EZR1e
NOSANA_MAX_TOKENS=480
NOSANA_TEMPERATURE=0.2
NOSANA_TOP_P=0.8
NOSANA_FIRST_TOKEN_TIMEOUT_MS=8000
NOSANA_TOTAL_TIMEOUT_MS=20000
NOSANA_FALLBACK_ENABLED=true
```

保留旧 3B Endpoint 和 model 作为可回滚配置，不要删除。通过环境变量或 Provider 配置切换，不允许写死 URL。

## 10. 验证任务

切换默认配置前必须完成：

1. 直接请求新 Nosana Endpoint，确认健康检查、模型名和 `stream=true` 均可用。
2. 至少运行 5 个固定 fixture，包括 HKG-BKK-ZRH Demo 主线。
3. 记录首 token 延迟、首完整区块延迟、总耗时、输出字符数、Schema 是否有效和是否降级。
4. 新模型有效结构成功率必须至少达到 90%。
5. 与现有 3B 模型比较中位首 token 和总耗时；只有新模型明显更快且内容满足 v2 验收标准时，才设为默认。
6. 验证 Nosana 断网、超时、非法 NDJSON、Android 主动离开页面和重复进入详情页。
7. 验证缓存命中时不产生第二次模型请求。
8. 验证日志和请求体不包含 PII。

## 11. 验收标准

- 详情页立即出现产品化分析进度，不出现长时间静态 Loading。
- 正文可以逐步显示，且不会重复、乱序或跳回。
- 不展示或伪造模型思维链。
- HKG-BKK-ZRH 的丰富推荐包含 v2 全部区块。
- 签证结论仍由确定性规则引擎给出。
- Nosana 不可用时，20 秒内完成模板降级，Demo 可以继续。
- 页面中不出现 Nosana、Qwen、GPU 或 Deployment 信息。
- 后端和 Android 均可通过单一配置回滚至旧 3B 非流式链路。

## 12. Qoder 执行 Prompt

```text
请在 /Users/zhengmin/Documents/黑客松/alibaba/project 中完整实施《LayoverJoy-Qwen2.5-1.5B流式AI实施任务.md》。

必须先阅读：
/Users/zhengmin/Documents/黑客松/alibaba/project/docs/LayoverJoy-Qwen2.5-1.5B流式AI实施任务.md

目标：将 Nosana 模型切换为 Qwen/Qwen2.5-1.5B-Instruct-AWQ，并同时打通 Nosana OpenAI-compatible streaming -> 后端 SSE -> Android Compose 增量渲染的完整链路。

关键约束：
1. 不展示模型隐藏思维链，只展示文档定义的产品化分析进度。
2. 保留 Rich AI Stopover Insight v2 全部内容区块，不得把 AI 降级为一两句推荐。
3. 签证规则由本地确定性引擎裁决，AI 只能解释。
4. 不向 Nosana 发送 PII。
5. 使用逐区块 NDJSON 约束模型输出，后端完成解析、校验后再发送规范 SSE。
6. 保留现有非流式接口、RichTemplateNarrator 降级和旧 3B 配置作为回滚路径。
7. 使用文档记录的新部署 Endpoint 和 Deployment ID；启动时先调用 `/v1/models`，以响应中的实际 `id` 作为 Chat Completions 的 `model`。Nosana 当前 served model name 是 `layoverjoy-qwen2.5-1.5b`，不要把 Hugging Face 仓库名误当成请求时的 model 值。
8. Android 进入详情页后自动生成；页面退出取消请求；重组不得重复请求。
9. UI 不显示 Nosana、Qwen、GPU、Deployment ID 或推理耗时；调试信息仅写入 BuildConfig.DEBUG 保护的 Log.d。
10. 首 token 超时 8 秒、总超时 20 秒，失败后自动返回同结构模板结果，不能无限 Loading。

请先梳理当前后端 AI Provider、详情页 ViewModel/UI、缓存和 RichTemplateNarrator 的实现，再按文档完成代码、配置、测试与 Demo fixture。不得破坏 Atlas Search/Verify/Order/Pay、签证 fail-closed、安全脱敏和现有 Demo 主线。

完成后请输出：
1. 修改文件清单。
2. 新流式链路的数据流说明。
3. 新增 SSE 事件契约与样例。
4. Nosana 实际健康检查和流式请求结果。
5. 5 个 fixture 的 Schema 成功率、首 token、中位总耗时和降级情况。
6. Android 实际页面状态变化。
7. 缓存、取消、超时和模板降级测试结果。
8. PII 检查结果。
9. 新旧模型切换与一键回滚方式。
10. 仍未完成或可能影响 2 分 58 秒 Demo 的问题。
```
