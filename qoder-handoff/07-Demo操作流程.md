# 07 · Demo 操作流程（真机 / 接口两套）

## 0. 前置状态（本机现已满足）

```bash
cd /Users/zhengmin/Documents/黑客松/alibaba/project
docker compose ps                    # 4 服务 Up（api/db/redis healthy）
curl -s localhost:8080/v1/health     # {"status":"ok",...}
export ADB=$HOME/Library/Android/sdk/platform-tools/adb
$ADB devices                         # emulator-5554 device

# 【必做】Nosana 探活：只看 /health 与 /v1/models（实测 2026-08-30 12:34 全 200）
B=$(grep NOSANA_OPENAI_BASE_URL ../.secrets/layoverjoy.env | cut -d= -f2-)
curl -s -o /dev/null -w 'nosana /health = %{http_code} in %{time_total}s\n' -m 15 "${B%/v1}/health"
curl -s -o /dev/null -w 'nosana /models = %{http_code} in %{time_total}s\n' -m 15 "$B/models"
# 期望 200。若是 503：进一个方案详情页“踢一脚”再轮询，等到 200 后先把中/英解释各预热一次再开录
# ⚠️ 切勿拿 NOSANA_DEPLOYMENT_URL 根路径探活：那里没有 handler，服务完全健康时它也恒返回 503
```

完整体检（57 项 PASS / 4 WARN / 0 FAIL 为基线）：`bash scripts/check-local-environment.sh --skip-tests`

登录账号：
- 已存在演示账号 `home1788013509@example.com`（DB 内，含中国普通护照 + 2 条证件）。**其口令未记录在任何文件中**（见 05 §6 G2）：请用户提供，或直接注册新账号（下 30 秒）。
- 注册新账号：App 登录页 → 注册；或
  ```bash
  # body: { email, password, displayName?, timezone?, residenceCountry? }
  curl -s -X POST localhost:8080/v1/auth/register -H 'Content-Type: application/json' \
    -d '{"email":"demo0830@example.com","password":"<你自己定的强口令>","displayName":"Demo","timezone":"Asia/Singapore","residenceCountry":"SG"}'
  ```
  > 收件邮箱建议用 **同域** `@aihackthon.atriptech.com`，否则外部域名投递会被中继拒绝（04 KN-02）。

## 1. 主 Demo 路线（推荐，全程真数据）

**故事线**：中国普通护照旅客，新加坡 → 上海，愿意在中转城市玩 3–4 天；App 先证明「能不能入境」，再解释「值不值得玩」，最后走通预订与监控。

| 步 | 界面动作 | 期望证据 |
|---|---|---|
| 1 | 启动 App → **Home** | Visa-Aware 机会卡（含目的地与「可入境」语气），底部四 tab：Home / Explore / Trips / Me |
| 2 | 点机会卡 CTA | 跳搜索页并**预填**目的地（如「香港 · 全市机场（HKG）」） |
| 3 | 改出发地/目的地 | 地点选择页：热门 + 最近（≤6）+ 洲→国家→城市三级浏览；输入 `sha`/`上海`/`SHANGHAI` 出现 **SHA/PVG 消歧**与「全市机场」选项 |
| 4 | 日期与偏好 | 停留天数、兴趣（美食/老城/购物…）、节奏、不要红眼 |
| 5 | 搜索 | 结果页：直飞基准 + 多个中转方案；每张卡带 **Atlas Sandbox 模拟报价** 标签 + 资格徽章（可预订 / 条件匹配 / 证件匹配 / 需复核 / 不可入境）+ 「为什么只留下这些城市」（候选数、被规则排除数、Sandbox 数、耗时、已清理） |
| 6 | 打开一个方案 | 详情页顶部**净体验窗口只出现一次**（如「2 个完整白天 · 需规划的一程城市停留」+ 时间预算说明 + 置信度）；入境资格证据卡（规则 ID / 停留上限 / **所需旅行证件**（含「必须」徽章）/ 官方来源 / 法律提示） |
| 7 | 停留 1–2 秒 | AI 推荐卡自动生成（先 Skeleton）：headline、城市优势（兴趣加权）、抵达日/完整游玩日/离境日三时段小行程、便利度分（如 51/100 · 需规划）、你得到 / 需要接受、消费者提示，footer「智能中转建议」 |
| 8 | 点「调整旅行偏好」 | 回到搜索页（这是有意的产品决策，不是「重新生成」） |
| 9 | 结果页/详情页开启**价格监控** | `MonitorSetupScreen` 设阈值 → 保存；worker 轮询；触发后站内通知 + 邮件（同域可达） |
| 10 | 进入**预订** | `BookingFlowScreen`：乘机人确认 → Verify（真实 Sandbox 验价）→ 两张独立单程 Order（MOCK）→ 模拟支付 → 涨价需重新确认 → 成功页/行程页 |
| 11 | （可选，展示风险透明）第二单失败 | 调 `/api/orders/{id}/simulate-leg-b-failure` → App 显示 `PARTIAL_BOOKING` → 模拟退款补偿 |
| 12 | 「我的」页切**英文** | 全 App 即时英文化（含 AI 卡、证件名、资格文案），无需重启 |

### Logcat 佐证（录制时不必展示，答疑时用）

```bash
$ADB logcat -d | grep LayoverJoyAI
# plan=xxxxxxxx request=xxxxxxxx provider=NOSANA model=… latencyMs=… deployment=… fallback=… prompt=stopover-value-v2
docker compose logs api | grep stopover_explanation_completed | tail -3
# event=stopover_explanation_completed requestTail=… provider=NOSANA latencyMs=… fallback=none promptVersion=stopover-value-v2
```

## 2. 纯接口版（网络/设备不配合时的兜底，同样真数据）

```bash
TOKEN=$(curl -s -X POST localhost:8080/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<演示邮箱>","password":"<口令>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# 1) 证件钱包
curl -s localhost:8080/v1/me/documents -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -30

# 2) 资格评估（AssessInput：itinerary 必带 segments / stopover / destination 之一；
#    不带 traveler.passport 时后端自动合并该用户的证件钱包）
curl -s -X POST localhost:8080/v1/entry-eligibility/assess -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "mode": "SEARCH",
    "itinerary": {
      "purpose": "tourism",
      "segments": [
        {"from": "SIN", "to": "ICN", "departureAt": "2026-09-18T09:00:00+08:00", "arrivalAt": "2026-09-18T15:40:00+09:00"},
        {"from": "ICN", "to": "LAX", "departureAt": "2026-09-21T11:20:00+09:00", "arrivalAt": "2026-09-21T06:30:00-07:00"}
      ],
      "stopover": {"country": "KR", "airport": "ICN", "stayHours": 74},
      "stayDays": 3,
      "arrivalDate": "2026-09-18",
      "destination": {"country": "US"}
    }}' | python3 -m json.tool | head -40

# 3) 发起搜索（Search Request V2：地点用 {cityId, mode, airportIata}，mode = ALL_AIRPORTS | AIRPORT；
#    接口是**异步**的 —— 先返回 searchRunId，再轮询状态）
curl -s -X POST localhost:8080/v1/searches -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
    "originLocation": {"cityId": "SIN", "mode": "ALL_AIRPORTS", "airportIata": null},
    "destinationLocation": {"cityId": "SHA", "mode": "ALL_AIRPORTS", "airportIata": null},
    "departureDate": "2026-09-18",
    "minStopDays": 3, "maxStopDays": 4,
    "preferences": {"interests": ["food", "oldtown"], "acceptRedEye": false}}' | python3 -m json.tool

# 4) 轮询与结果
# curl -s localhost:8080/v1/searches/<searchRunId> -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -30
curl -s "localhost:8080/v1/searches/<searchRunId>/plans" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -40

# 5) 方案详情（含 experienceContext + eligibility.requiredDocuments 对象数组）
curl -s "localhost:8080/v1/plans/<planId>?lang=zh" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d.get('experienceContext'),ensure_ascii=False,indent=1));print(json.dumps(d['eligibility']['requiredDocuments'],ensure_ascii=False,indent=1)[:600])"

# 6) AI 解释（**无 request body**，只有 ?lang=；interests/pace 来自该方案所属搜索的 preferences。
#    GET 与 POST 走同一个 explain()：命中缓存则直接返回，未命中才调推理）
curl -s -X POST "localhost:8080/v1/plans/<planId>/explanation?lang=en" -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool | head -60
```

**契约提醒**（`backend/src/search/search.service.ts:8` `SearchRequestInput`、`entry-rules/v2/types.ts:95` `AssessInput`、Swagger 未声明 requestBody，**别看 `/docs` 猜字段**）：字段名是 `departureDate`（不是 `departDate`）、`minStopDays/maxStopDays`（不是 `stopoverDays` 数组）、`preferences.{interests,acceptRedEye,airlines,demoFixture}`；地点 `mode` 只有 `ALL_AIRPORTS` / `AIRPORT` 两个值；旧字符串 `origin/destination` 仍兼容（迁移期），但 V2 优先且**只信任 `cityId/mode/airportIata`**。同城起返会报 `SAME_ORIGIN_DESTINATION`，目录外报 `INVALID_LOCATION_SELECTION`。

## 3. 三个必讲的规则场景（13 号方案验收过的真实结论）

| 场景 | 无美国签证 | 持有效 B1/B2 | 改直飞目的地 PVG |
|---|---|---|---|
| SIN → **ICN** → LAX（经韩国入美） | `NEEDS_INFO`（缺事实，不猜） | `CONDITIONAL` + 预订 `NEEDS_REVIEW`（材料待核验） | 不命中第三国过境规则 |

对照负例：**经马尼拉（PH）第三国过境 → `INELIGIBLE`**（负向规则优先，覆盖 14 天免签）；**新加坡中转 ≠ VFTF 便利**（互免 ≠ 过境免签）；**香港「真实第三国过境」CONDITIONAL vs「往返式行程」需复核**；**柬埔寨 10-10 ELIGIBLE / 10-16 需复核**（临时政策 `effectiveTo` 零点失效）。

## 4. 录屏（3 分钟视频）

```bash
export ADB=$HOME/Library/Android/sdk/platform-tools/adb
$ADB shell screenrecord --time-limit 180 --bit-rate 8000000 /sdcard/demo.mp4 &
# …按 §1 表格点完 12 步…
$ADB shell pkill -2 screenrecord    # 或等 180s 自动停
sleep 3 && $ADB pull /sdcard/demo.mp4 ~/Desktop/layoverjoy-demo.mp4 && $ADB shell rm /sdcard/demo.mp4
```

- `screenrecord` 硬上限 180s，正好等于官方 3 分钟限制 → **不要彩排超时**。
- 录制前先手动跑一遍让 Nosana 结果进缓存（缓存键含 lang，中/英各热一次）。
- 需要更长的录制/剪辑：`adb shell screenrecord` 不支持 >180s，改分段录制后拼接，或用 QuickTime 模拟器窗口采集。

## 5. 已知会影响演示的点位

1. **英文解释更慢**：en 约 4s、zh 约 2s（3b 模型 + RTX 3060 ~25 tok/s）。若 <2s 是硬需求 → 不可达，除非换更小模型或全部走模板（04 KN-01）。
2. **`NO_SANDBOX_INVENTORY`**：Sandbox 指定日期可能无票，会出现 fixture 回退（UI 标 MOCK）—— 演示日期临时改期要先实跑一次 Search 确认。
3. **外部邮箱收不到信**：演示账号用同域邮箱（KN-02）。
4. **Redis 挂了不报错**：`docker compose ps` 必须看到 redis healthy（KN-03）。
5. **改了 `.secrets` 但容器没变**：见 KN-04，`unset` 残留 export 后 `--force-recreate`。
6. **Nosana 休眠导致开场 503**：见 KN-07 —— 录制前必须探测（只看 `/health`/`/v1/models`，根路径恒 503 不算故障）+ 预热，否则会当场降级成模板叙事（观感无异但口径不能再称“真实模型生成”）。2026-08-30 12:34 实测已全绿。
