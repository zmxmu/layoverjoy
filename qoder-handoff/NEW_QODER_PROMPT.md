# NEW_QODER_PROMPT · 直接粘贴给新账号的首条 Prompt

用法：整段复制下面代码块，发给新 Qoder 账号（同一台 Mac、同一份 `/Users/zhengmin/Documents/黑客松/alibaba/project`）。

---

```text
你接手的是 LayoverJoy 项目，前一个会话已把全部上下文写成交接包。现在**只做「读取 + 体检 + 汇报」，不要改任何代码**。

项目目录：/Users/zhengmin/Documents/黑客松/alibaba/project
唯一密钥文件：/Users/zhengmin/Documents/黑客松/alibaba/.secrets/layoverjoy.env（26 个变量，0600，永不进 Git）
Android 包名：com.yuanhe.layoverjoy（禁止更改）

## 第一步：读文档（按序，全读完再动手）

1. project/AGENTS.md —— 项目最高约束（冲突时的优先事实源），尤其 §5 Secret 安全、§3 Atlas 口径、§4 签证安全、§8 预订、§11 完成门禁
2. project/qoder-handoff/00-新账号启动说明.md —— 边界、五条硬禁区、自检基线
3. project/qoder-handoff/05-完整环境变量与密钥.md —— 代码实际读取的变量名、值在哪、三处冲突裁决、缺失怎么办
4. project/qoder-handoff/06-本机开发环境.md —— JDK/Android SDK/adb/Docker/端口/模拟器真实路径
5. project/qoder-handoff/02-项目架构与模块说明.md —— 七个服务职责与真实/Mock 边界
6. project/qoder-handoff/03-已完成功能.md 与 04-未完成任务与已知问题.md —— 做到哪、还剩什么
7. project/qoder-handoff/07-Demo操作流程.md —— 演示路线与 API 契约（字段名以它为准，别猜）
8. project/qoder-handoff/08-最近问题排查记录.md —— 已踩过的坑与修法
9. 需要更多背景时读 ../qoder-input/00～10 号方案文档与 docs/IMPLEMENTATION_STATUS.md

## 第二步：环境变量落地情况

- 检查 qoder-handoff/full-env-backup.txt 与 project/.env.local 是否存在。
- 本次交接**刻意没有生成**这两个明文密钥副本（原因写在 00 号文档「关于密钥」一节：AGENTS.md §5 明文禁止把 Secret 写进 Markdown，且仓库有 GitHub remote）。
- 因此：
  - **不要**为了让它们出现而自己创建明文副本，**不要**把 .secrets 内容打印到聊天、日志或任何 .md 里；
  - 需要整体明文时，请**让用户本人在终端执行** `bash scripts/export-env-bundle.sh --write`（产物 qoder-handoff/env-bundle.local.txt，已 gitignore）；
  - 需要判断某个值对不对时，用**指纹校验**：`bash scripts/export-env-bundle.sh`（干跑，只输出键名+长度+sha256-8），与 05 §1 的指纹表逐行比对；
  - `.env.local` 对当前运行方式**不是必需**（docker compose 直接 `env_file: ../.secrets/layoverjoy.env`）；只有在「后端不进 Docker、本机直跑」时才需要，且由用户自己复制。
- 汇报时请明确列出：哪些变量已取得完整值（按引用+指纹）、哪些确实缺失需要用户提供（05 §6 的 G1–G4 与 HF_TOKEN）。

## 第三步：环境与运行状态体检（只读命令）

    cd /Users/zhengmin/Documents/黑客松/alibaba/project
    bash scripts/check-local-environment.sh --skip-tests
    docker compose ps
    curl -s localhost:8080/v1/integrations | python3 -m json.tool
    docker exec project-db-1 pg_isready -U layoverjoy -d layoverjoy
    docker exec project-redis-1 redis-cli ping
    git log --oneline -8

已知基线（2026-08-30 12:35 实测）：PASS=57 / WARN=4 / FAIL=0；4 个容器 Up（api/db/redis/monitor-worker）；
`/v1/integrations` 应为 atlasMode=sandbox、Search/Verify=ATLAS_SANDBOX、Order/Pay/Refund=MOCK、
daytonaMode=local-runner、mailProvider=smtp、model=layoverjoy-qwen2.5-3b、database=ok。

Nosana 推理已确认健康（`/health`、`/v1/models`、`/v1/chat/completions` 全 200）。历史踩坑：
交接当日 12:12–12:18 曾真发生 GPU 实例休眠 503（已自愈，见 04 KN-07）；而
`NOSANA_DEPLOYMENT_URL` 根路径**恒 503**（无 handler），**不是故障信号**，不要拿它探活。
**不要**试图通过改后端代码、改 Atlas 凭据或换 Provider 来“绕过”推理可用性问题。

## 第四步：汇报（先汇报，别动手）

用中文给出一份汇报，包含：
1. 环境与运行状态体检结果（逐项 PASS/WARN/FAIL 与与基线的差异）
2. 环境变量落地情况：按引用可校验的 / 缺失需用户提供的
3. 项目完成度：各模块（首页、注册登录、证件钱包、城市选择、航班搜索、签证资格判断、方案详情、AI 推荐、预订、价格监控与通知）真实/模拟边界与状态
4. 已知问题与当前最优先要办的事（注意：Atlas 侧提交截止 2026-08-30 23:59 SGT，录视频优先于改代码）
5. 你建议的下一步（最多 3 条，标出优先级与影响面）
6. 你不打算碰的东西及原因（包名、Atlas 凭据、Order/Pay/Refund=MOCK、规则引擎与 LLM 的职责边界）

## 硬性约束（违反即返工）

- **不要立即重构项目**，不要升级依赖、不要改构建配置、不要调整目录结构。
- **不要更换 Android 包名** `com.yuanhe.layoverjoy`。
- **不要覆盖已有有效环境变量值**，不要重写 `../.secrets/layoverjoy.env`。要加新变量：先加 `backend/src/config/env.ts` 的 Zod schema，再写文件。
- **不要**改 `ATLAS_CLIENT_ID` / `ATLAS_CLIENT_SECRET` / `ATLAS_BASE_URL` / Sandbox 配置（代码里没有 `ATRIP_*` 这类变量，05 §3 有命名纠正）。
- **不要**把 Order/Pay/Refund 改成非 mock（Zod 枚举层面不允许）。
- **不要**让 LLM 产出签证/入境结论（v2 规则引擎是唯一事实源，AI 只做叙事）。
- **不要**把 `requiredDocuments` 从对象数组降级回字符串数组（08 §1 的教训）。
- 改任何代码前**必须先得到用户确认**；用户没点头就只读不写。
- 收尾门禁（真要改代码时）：`cd backend && npx tsc --noEmit && npx vitest run`（基线 66 passed）、`cd android && ./gradlew testDebugUnitTest assembleDebug`、`bash scripts/check-i18n.sh`（基线 308 key）。
- 无法确认的事写「待确认」，不要猜测，不要虚构密钥或凭据。
```

---

## 给用户的一句话说明

新账号跑完体检后，如果它问你要明文密钥：**不需要给它**。你自己在终端跑
`bash scripts/export-env-bundle.sh --write`，产物留在本机 `qoder-handoff/env-bundle.local.txt`；
新账号在同一台机器上本来就有读取权限（它能通过 `docker exec project-api-1 env` 看到生效值），
把明文再粘进对话只会扩大泄露面、不会增加它的能力。
