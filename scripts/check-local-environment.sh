#!/usr/bin/env bash
# LayoverJoy 本机环境自检（交接包配套）
#
#   bash scripts/check-local-environment.sh                # 默认：密钥只显示「是否配置 + 长度 + SHA-256 前 8 位指纹」
#   bash scripts/check-local-environment.sh --show-values  # 在你自己的终端打印完整明文值（不会写入任何文件）
#   bash scripts/check-local-environment.sh --skip-tests   # 只查配置，不跑 tsc/vitest/i18n（最快）
#
# 设计原则：
#  1) 值只有一个来源 —— ../.secrets/layoverjoy.env + 运行中的容器，脚本只读不算、不写文件、不改 .env；
#  2) 默认脱敏是为了防止「截图/粘贴到聊天」这类二次泄露，--show-values 由你显式承担；
#  3) 每一项给出 PASS / WARN / FAIL 与可执行修法。

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="$PROJECT_DIR/../.secrets/layoverjoy.env"
SHOW_VALUES=0
SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --show-values) SHOW_VALUES=1 ;;
    --skip-tests)  SKIP_TESTS=1 ;;
    -h|--help)     grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：${arg}（用 --help 看用法）"; exit 2 ;;
  esac
done

PASS=0; WARN=0; FAIL=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; WARN=$((WARN+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
sect() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
cmd()  { command -v "$1" >/dev/null 2>&1; }

# 读取 .secrets 中某个键的值（不 export，不写文件）
secret_val() { [ -f "$SECRETS_FILE" ] && grep -E "^\s*$1=" "$SECRETS_FILE" | tail -1 | sed -E "s/^\s*$1=//" | sed -E 's/^"(.*)"$/\1/' | sed -E "s/^'(.*)'\$/\1/"; }

# 打印一个变量：脱敏模式显示 长度 + sha256-8；--show-values 显示原文
show_var() {
  local name="$1" val="${2:-}"
  if [ -z "$val" ]; then warn "$name = <未设置>"; return; fi
  if [ "$SHOW_VALUES" = "1" ]; then
    printf '  \033[32mPASS\033[0m  %s = %s\n' "$name" "$val"
  else
    local fp; fp=$(printf '%s' "$val" | shasum -a 256 2>/dev/null | cut -c1-8)
    printf '  \033[32mPASS\033[0m  %s = <len=%d sha256-8=%s>（--show-values 看原文）\n' "$name" "${#val}" "$fp"
  fi
  PASS=$((PASS+1))
}

printf '\033[1mLayoverJoy 环境自检\033[0m  project=%s\n' "$PROJECT_DIR"
[ "$SHOW_VALUES" = "1" ] && printf '\033[33m⚠ 明文打印模式：本次终端输出含真实密钥，切勿截图或粘贴到任何外部工具。\033[0m'

# ---------------------------------------------------------------- 1. 工具链
sect "1. 工具链"
if cmd java; then
  # 不用 `| head -1 | grep`：pipefail + SIGPIPE 组合下取值会变空，改为 sed 一次抽取
  JV=$(java -version 2>&1 | sed -nE 's/.*version "([0-9]+)[^"]*".*/\1/p' | head -1)
  [ -z "$JV" ] && JV=$(java -version 2>&1 | sed -nE 's/^[^0-9]*([0-9]+).*/\1/p' | head -1)
  if [ "${JV:-0}" = "17" ]; then ok "Java 17：$(java -version 2>&1 | sed -n 1p)"; else
    warn "Java 主版本 = ${JV:-unknown}（期望 17；Gradle/AGP 对 JDK 版本敏感）"
  fi
  ok "java 路径：$(command -v java)"
  if [ -n "${JAVA_HOME:-}" ]; then ok "JAVA_HOME=$JAVA_HOME"; else
    if [ -x /usr/libexec/java_home ]; then warn "JAVA_HOME 未设置（建议 ~/.zshrc 追加：export JAVA_HOME=\$(/usr/libexec/java_home -v 17)）"; else warn "JAVA_HOME 未设置且无 /usr/libexec/java_home"; fi
  fi
else bad "java 不可用"; fi

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [ -d "$SDK" ]; then ok "Android SDK：$SDK"; else bad "Android SDK 目录不存在：${SDK}（并检查 android/local.properties 的 sdk.dir）"; fi
ADB_PATH="$SDK/platform-tools/adb"
if cmd adb; then ok "adb 在 PATH：$(command -v adb)"; elif [ -x "$ADB_PATH" ]; then
  warn "adb 不在 PATH，可用绝对路径：${ADB_PATH}（非登录 shell 常见）"
else bad "adb 找不到"; fi
if [ -x "$SDK/emulator/emulator" ]; then ok "emulator：$($SDK/emulator/emulator -list-avds 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')"; else warn "emulator 可执行文件缺失"; fi
cmd docker || bad "docker 不在 PATH"
[ -f "$PROJECT_DIR/android/gradlew" ] && ok "Gradle wrapper：$(grep -oE 'gradle-[0-9.]+-bin' "$PROJECT_DIR/android/gradle/wrapper/gradle-wrapper.properties" | head -1)" || warn "gradlew 缺失"
cmd node && ok "Node $(node -v)" || warn "node 不在 PATH（后端 npm/npx 需要）"

# ---------------------------------------------------------------- 2. 设备
sect "2. Android 设备"
ADB_BIN=$(command -v adb || echo "$ADB_PATH")
if [ -x "$ADB_BIN" ]; then
  DEV=$("$ADB_BIN" devices | awk 'NR>1 && $2=="device"{print $1}' | tr '\n' ' ' | sed 's/ *$//')
  if [ -n "$DEV" ]; then ok "已连接设备：$DEV"; else warn "无 device 状态的设备（模拟器未启动？）"; fi
  if [ -n "$DEV" ] && "$ADB_BIN" shell pm list packages 2>/dev/null | grep -q '^package:com.yuanhe.layoverjoy$'; then
    ok "已安装 com.yuanhe.layoverjoy"
  else warn "未安装 com.yuanhe.layoverjoy（./gradlew assembleDebug && adb install -r …）"; fi
fi

# ---------------------------------------------------------------- 3. 容器
sect "3. Docker Compose 服务"
if cmd docker; then
  cd "$PROJECT_DIR" || exit 1
  if ! docker info >/dev/null 2>&1; then bad "Docker 守护进程未运行（打开 Docker Desktop）"
  else
    ok "Docker：$(docker --version)"
    docker compose ps --format '{{.Service}}\t{{.State}}\t{{.Status}}' 2>/dev/null | while IFS=$'\t' read -r s st stat; do
      case "$stat" in *healthy*) printf '  \033[32mPASS\033[0m  %-16s %s\n' "$s" "$stat";;
                     *Up*)      printf '  \033[32mPASS\033[0m  %-16s %s\n' "$s" "$stat";;
                     *)         printf '  \033[31mFAIL\033[0m  %-16s %s\n' "$s" "$stat";; esac
    done
    for need in api db redis monitor-worker; do
      docker compose ps --format '{{.Service}}' 2>/dev/null | grep -qx "$need" || bad "缺少服务：${need}（docker compose up -d --build）"
    done
  fi
fi

# ---------------------------------------------------------------- 4. 密钥文件
sect "4. 环境变量文件"
if [ -f "$SECRETS_FILE" ]; then
  CNT=$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$SECRETS_FILE")
  if [ "$CNT" -ge 20 ]; then ok "唯一密钥文件：${SECRETS_FILE}（${CNT} 个变量）"; else warn "密钥文件只有 ${CNT} 个变量（基线为 26）"; fi
  PERM=$(ls -l "$SECRETS_FILE" | awk '{print $1}')
  [ "$PERM" = "-rw-------" ] && ok "文件权限 ${PERM}（0600）" || warn "文件权限 ${PERM}（建议 chmod 600）"
  grep -qE '\.secrets' "$PROJECT_DIR/.gitignore" 2>/dev/null && ok ".gitignore 已排除 .secrets/" || bad ".gitignore 未排除 .secrets/（立刻补，密钥可能已入库）"
else bad "密钥文件缺失：$SECRETS_FILE —— 需要用户重新提供（见 qoder-handoff/05）"; fi

MUST_SET="DATABASE_URL JWT_SECRET DATA_ENCRYPTION_KEY ATLAS_CLIENT_ID ATLAS_CLIENT_SECRET NOSANA_API_KEY NOSANA_OPENAI_BASE_URL DAYTONA_API_KEY SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD ATLAS_WEBHOOK_SHARED_TOKEN"
for k in $MUST_SET; do
  v=$(secret_val "$k"); [ -n "$v" ] || bad "必要变量未在 .secrets 中找到：$k"
  if printf '%s' "${v:-}" | grep -qE '([•●*]{3,}|REPLACE_ME|CHANGEME)'; then bad "$k 看起来是脱敏占位符（后端 isMaskedSecret() 会判为无效 Secret）"; fi
done
[ -z "${NOSANA_API_KEY:-}" ] || true

sect "5. 关键配置项（值）"
show_var "ATLAS_MODE"                "$(secret_val ATLAS_MODE)"
show_var "ATLAS_BASE_URL"            "$(secret_val ATLAS_BASE_URL)"
show_var "ATLAS_CLIENT_ID"           "$(secret_val ATLAS_CLIENT_ID)"
show_var "ATLAS_CLIENT_SECRET"       "$(secret_val ATLAS_CLIENT_SECRET)"
show_var "NOSANA_MODEL"              "$(secret_val NOSANA_MODEL)"
show_var "NOSANA_DEPLOYMENT_ID"      "$(secret_val NOSANA_DEPLOYMENT_ID)"
show_var "NOSANA_OPENAI_BASE_URL"    "$(secret_val NOSANA_OPENAI_BASE_URL)"
show_var "NOSANA_API_KEY"            "$(secret_val NOSANA_API_KEY)"
show_var "DAYTONA_API_URL"           "$(secret_val DAYTONA_API_URL)"
show_var "DAYTONA_API_KEY"           "$(secret_val DAYTONA_API_KEY)"
show_var "JWT_SECRET"                "$(secret_val JWT_SECRET)"
show_var "DATA_ENCRYPTION_KEY"       "$(secret_val DATA_ENCRYPTION_KEY)"
show_var "ATLAS_WEBHOOK_SHARED_TOKEN" "$(secret_val ATLAS_WEBHOOK_SHARED_TOKEN)"
show_var "SMTP_HOST"                 "$(secret_val SMTP_HOST)"
show_var "SMTP_PORT"                 "$(secret_val SMTP_PORT)"
show_var "SMTP_SECURE"               "$(secret_val SMTP_SECURE)"
show_var "SMTP_USER"                 "$(secret_val SMTP_USER)"
show_var "SMTP_PASSWORD"             "$(secret_val SMTP_PASSWORD)"
show_var "MAIL_FROM"                 "$(secret_val MAIL_FROM)"
show_var "DATABASE_URL"              "$(secret_val DATABASE_URL)"
show_var "ANDROID_APPLICATION_ID"    "$(secret_val ANDROID_APPLICATION_ID)"
show_var "ANDROID_BACKEND_URL"       "$(secret_val ANDROID_BACKEND_URL)"
[ -n "$(secret_val ADMIN_DEBUG_TOKEN)" ] && show_var "ADMIN_DEBUG_TOKEN" "$(secret_val ADMIN_DEBUG_TOKEN)" \
  || warn "ADMIN_DEBUG_TOKEN 未设置 → POST /api/debug/webhooks/atlas/simulate 会 403（见 05 §6 G1）"

sect "6. 宿主 shell 残留变量（compose 会用它覆盖 env_file！）"
LEAK=0
for k in NOSANA_OPENAI_BASE_URL NOSANA_DEPLOYMENT_ID NOSANA_MODEL DAYTONA_MODE; do
  hv="${!k:-}"
  if [ -n "$hv" ]; then LEAK=1; show_var "$k(shell)" "$hv"; fi
done
if [ "$LEAK" = "0" ]; then ok "无残留 export（干净）"; else
  warn "上述 shell 值会**覆盖** .secrets 同名项（compose environment 优先级高于 env_file）→ 不确定就 unset 后 --force-recreate"
fi

# ---------------------------------------------------------------- 7. 运行期
sect "7. 运行期健康"
BASE=http://localhost:8080
H=$(curl -s -m 5 "$BASE/v1/health" || true)
if printf '%s' "$H" | grep -q '"status":"ok"'; then ok "Backend $BASE/v1/health → ok"; else bad "Backend 未响应（${BASE}）"; fi
IG=$(curl -s -m 5 "$BASE/v1/integrations" || true)
if [ -n "$IG" ]; then
  for pair in '"atlasMode":"sandbox|Atlas 模式应为 sandbox' '"searchProvider":"ATLAS_SANDBOX|Search 应为真实 Sandbox' '"verifyProvider":"ATLAS_SANDBOX|Verify 应为真实 Sandbox' '"orderProvider":"MOCK|Order 应为 MOCK' '"paymentProvider":"MOCK|Pay 应为 MOCK' '"refundProvider":"MOCK|Refund 应为 MOCK' '"database":"ok|数据库连接 ok' '"provider":"nosana|推理 Provider 应为 nosana' '"configured":true|Nosana 已配置' '"mode":"local-runner|Daytona local-runner'; do
    pat=${pair%%|*}; msg=${pair#*|}
    printf '%s' "$IG" | grep -q "$pat" && ok "$msg" || bad "${msg}（检查 .secrets 与 compose 覆盖）"
  done
  printf '%s' "$IG" | grep -q '"mailProvider":"smtp"' && ok "邮件 Provider = smtp" || warn "邮件 Provider 非 smtp"
  echo "  ---- /v1/integrations 原文（不含密钥）----"
  printf '%s\n' "$IG" | python3 -m json.tool 2>/dev/null | sed 's/^/    /' | head -32
else bad "无法读取 $BASE/v1/integrations"; fi

if cmd docker; then
  docker exec project-db-1 pg_isready -U layoverjoy -d layoverjoy >/dev/null 2>&1 && ok "PostgreSQL pg_isready" || bad "PostgreSQL 未就绪"
  docker exec project-redis-1 redis-cli ping 2>/dev/null | grep -q PONG && ok "Redis PONG" || bad "Redis 无响应（会静默降级为进程内 Map，见 04 KN-03）"
  RS=$(docker exec project-db-1 psql -U layoverjoy -d layoverjoy -tAc "select status||'/'||\"schemaVersion\"||' asOf '||coalesce(\"asOf\"::text,'-') from \"EntryRuleSet\" limit 1;" 2>/dev/null)
  [ -n "$RS" ] && ok "入境规则集：$RS" || warn "读不到 EntryRuleSet（api 未启动或未导入）"
  NS=$(docker exec project-db-1 psql -U layoverjoy -d layoverjoy -tAc "select count(*) from \"NotificationDelivery\" where status='SENT';" 2>/dev/null)
  NF=$(docker exec project-db-1 psql -U layoverjoy -d layoverjoy -tAc "select count(*) from \"NotificationDelivery\" where status='FAILED';" 2>/dev/null)
  [ -n "${NS:-}" ] && warn "邮件投递 SENT=${NS} / FAILED=${NF}（FAILED 通常为外部域名被中继拒绝，见 04 KN-02）"
fi

sect "8. 外部服务连通性"
NOSE=$(secret_val NOSANA_OPENAI_BASE_URL)
if [ -n "$NOSE" ]; then
  CODE=$(curl -s -o /tmp/lj_nos_models -w '%{http_code} %{time_total}s' -m 15 "$NOSE/models" || echo "000 -")
  case "$CODE" in
    200*) ok "Nosana $NOSE/models → $CODE";;
    404*) warn "Nosana 无 /v1/models（vLLM 栈常见，服务仍可用；实际推理走 native /api/chat 自适应）";;
    503*) bad "Nosana 503：部署未就绪（body 多为 'Service Initializing'）→ AI 解释会全部降级模板；需到 Nosana 管理页重启/等自愈，见 04 §1";;
    *) bad "Nosana 不可达：$CODE → 解释会全部降级模板（04 KN-01）";;
  esac
else bad "NOSANA_OPENAI_BASE_URL 未设置"; fi
ALB=$(secret_val ATLAS_BASE_URL); AEP="${ALB:-https://sandbox.atriptech.com}"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 12 "$AEP" || echo 000)
if [ "$CODE" = "000" ]; then bad "Atlas 主机不可达：${AEP}（网络/VPN？）"; else ok "Atlas 主机可达：${AEP} → HTTP ${CODE}（未带凭据探测，仅连通性）"; fi
SMH=$(secret_val SMTP_HOST); SMP=$(secret_val SMTP_PORT)
# 用 nc 探测；无 nc 时回退 python3 socket。不用 bash /dev/tcp：部分受限 shell 会直接被 Kill，造成假 FAIL
probe_tcp() {
  if cmd nc; then nc -z -G 8 "$1" "$2" >/dev/null 2>&1
  else python3 -c "import socket,sys;socket.create_connection((sys.argv[1],int(sys.argv[2])),timeout=8).close()" "$1" "$2" >/dev/null 2>&1
  fi
}
if [ -n "$SMH" ]; then
  probe_tcp "$SMH" "${SMP:-465}" && ok "SMTP 端口可达：$SMH:${SMP:-465}" || bad "SMTP 端口不可达：$SMH:${SMP:-465}"
else bad "SMTP_HOST 未设置"; fi

# ---------------------------------------------------------------- 9. 质量门禁
if [ "$SKIP_TESTS" = "0" ] && cmd npx; then
  sect "9. 代码质量门禁（--skip-tests 可跳过）"
  ( cd "$PROJECT_DIR/backend" && npx tsc --noEmit >/tmp/lj_env_tsc.log 2>&1 ) \
    && ok "backend tsc 0 error" || { bad "backend tsc 报错"; tail -5 /tmp/lj_env_tsc.log | sed 's/^/      /'; }
  VT=$( cd "$PROJECT_DIR/backend" && npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | tail -1 )
  [ -n "$VT" ] && ok "backend vitest：${VT}（基线 66 passed）" || bad "backend vitest 未通过"
  KI=$(bash "$PROJECT_DIR/scripts/check-i18n.sh" 2>&1 | tail -1)
  printf '%s' "$KI" | grep -q '✅' && ok "i18n：$KI" || bad "i18n 缺 key：$KI"
  if [ -x "$PROJECT_DIR/android/gradlew" ]; then warn "Android 单测/构建较慢，未在此运行：cd android && ./gradlew testDebugUnitTest assembleDebug"; fi
else
  sect "9. 代码质量门禁（已跳过）"
fi

sect "结果"
printf '  PASS=%d  WARN=%d  FAIL=%d\n\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "  有 FAIL 项。优先顺序：Docker 守护进程 → .secrets 完整性 → api 健康 → 外部服务连通性。"
  echo "  逐项修法见 qoder-handoff/05-完整环境变量与密钥.md 与 08-最近问题排查记录.md"
  exit 1
fi
echo "  环境可用。下一步：读 qoder-handoff/07-Demo操作流程.md"
exit 0
