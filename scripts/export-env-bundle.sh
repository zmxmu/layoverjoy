#!/usr/bin/env bash
# LayoverJoy 环境变量导出器（交接包配套）
#
#   bash scripts/export-env-bundle.sh                 # 干跑：只列 键名 + 长度 + SHA-256 前 8 位指纹，不写文件
#   bash scripts/export-env-bundle.sh --stdout        # 明文打到终端（自行负责不留痕）
#   bash scripts/export-env-bundle.sh --write         # 明文写入 qoder-handoff/env-bundle.local.txt（已 gitignore，0600）
#   bash scripts/export-env-bundle.sh --write --out qoder-handoff/full-env-backup.txt
#
# 为什么要你亲手执行这一步：AGENTS.md §5 明令「任何真实 Key/Secret/密码/Token 不得写入源码、
# Markdown、Fixture、APK 或日志」，而本仓库配了 GitHub remote。所以交接文档里只留「值在哪 + 指纹」，
# 明文落地由你在本机决定。指纹可用来在新环境校验「值是否一模一样」。
#
# 只读源：../.secrets/layoverjoy.env（唯一密钥文件）+ 运行中的容器 env。不修改任何配置。

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="$PROJECT_DIR/../.secrets/layoverjoy.env"
OUT="$PROJECT_DIR/qoder-handoff/env-bundle.local.txt"
MODE="dry"

while [ $# -gt 0 ]; do
  case "$1" in
    --stdout) MODE="stdout" ;;
    --write)  MODE="write" ;;
    --out)    shift; OUT="${1:?--out 需要一个路径}" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
  shift
done

[ -f "$SECRETS_FILE" ] || { echo "FAIL 找不到唯一密钥文件：$SECRETS_FILE —— 需要用户重新提供"; exit 1; }

val_of() { grep -E "^\s*$1=" "$SECRETS_FILE" | tail -1 | sed -E "s/^\s*$1=//;s/^\"(.*)\"\$/\1/;s/^'(.*)'\$//"; }
keys()   { grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$SECRETS_FILE" | sed -E 's/=.*//'; }
fp8()    { printf '%s' "$1" | shasum -a 256 2>/dev/null | cut -c1-8; }

CONTAINER="project-api-1"
docker inspect "$CONTAINER" >/dev/null 2>&1 || CONTAINER=""

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

{
  echo "# LayoverJoy 完整环境变量包"
  echo "# 生成时间 : $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "# 生成主机 : $(hostname) / user $(id -un)"
  echo "# 值来源   : ${SECRETS_FILE}（本机唯一密钥文件，0600，不进 Git）"
  echo "# 用法     : cp 到新机器同路径后 chmod 600；或 docker compose --env-file；或 set -a; . 之; set +a"
  echo "# 安全     : 本文件已被 qoder-handoff/.gitignore 排除。不要提交、不要上传网盘/聊天工具、"
  echo "#            不要整份粘给 AI 会话。用完请 rm 本文件。"
  echo
} > "$TMP"

# ---- 主体：原样保留 .secrets 的键值（值只有一个来源，不做任何"修正"）----
echo "# ==== 1. .secrets/layoverjoy.env 全量（$(keys | wc -l | tr -d ' ') 个变量）====" >> "$TMP"
while IFS= read -r line; do
  if printf '%s' "$line" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*='; then
    echo "$line" >> "$TMP"
  elif [ -n "$line" ]; then
    echo "$line" >> "$TMP"
  fi
done < "$SECRETS_FILE"
echo >> "$TMP"

# ---- compose / 代码注入但 .secrets 里没有的运行期变量 ----
if [ -n "$CONTAINER" ]; then
  {
    echo "# ==== 2. 运行中容器生效、但 .secrets 未列出的变量（由 docker-compose.yml 注入）===="
    docker exec "$CONTAINER" env | grep -E '^(NODE_ENV|PORT|HOST|RUNTIME_TARGET|PUBLIC_BASE_URL|LOG_LEVEL|TZ|DATABASE_URL|REDIS_URL|PATH=)' \
      | grep -vE '^(PATH|TZ)=' | sort || true
  } >> "$TMP"
  echo >> "$TMP"
fi

# ---- 漂移审计：.secrets vs 容器实际值（compose environment 块 / shell 残留会覆盖 env_file）----
DRIFT=""
if [ -n "$CONTAINER" ]; then
  CENVDUMP=$(docker exec "$CONTAINER" env 2>/dev/null || true)
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    fv=$(val_of "$k"); cv=$(printf '%s\n' "$CENVDUMP" | grep -E "^$k=" | head -1 | sed "s/^$k=//")
    if [ -n "$cv" ] && [ "$fv" != "$cv" ]; then DRIFT="${DRIFT}  DIFF  $k : .secrets(len=${#fv} fp=$(fp8 "$fv")) vs 容器(len=${#cv} fp=$(fp8 "$cv"))"$'\n'; fi
    sv=$(printenv "$k" || true)
    if [ -n "$sv" ] && [ "$sv" != "$fv" ]; then DRIFT="${DRIFT}  SHELL $k : 宿主 export 会覆盖 env_file，值不同 fp=$(fp8 "$sv")"$'\n'; fi
  done < <(keys)
fi
{
  echo "# ==== 3. 漂移审计（容器实际生效值 vs 文件值；shell 残留 export）===="
  if [ -z "$DRIFT" ]; then echo "# 无差异：容器生效值 == .secrets 文件值，且宿主无残留 export"; else printf '%s' "$DRIFT"; fi
} >> "$TMP"
echo >> "$TMP"
echo "# ==== 4. 校验指纹（新机器导入后跑同样算法，应逐行一致）====" >> "$TMP"
while IFS= read -r k; do
  v=$(val_of "$k"); [ -n "$v" ] || continue
  echo "# $k len=${#v} sha256-8=$(fp8 "$v")" >> "$TMP"
done < <(keys)

case "$MODE" in
  dry)
    echo "模式：干跑（不写文件、不打明文）。共 $(keys | wc -l | tr -d ' ') 个变量。"
    grep '^# [A-Z]' "$TMP"
    [ -n "$DRIFT" ] && { echo; echo "⚠ 漂移："; printf '%s' "$DRIFT"; }
    echo
    echo "要明文：加 --stdout（只到终端）或 --write（写 ${OUT}）"
    ;;
  stdout)
    cat "$TMP"
    ;;
  write)
    mkdir -p "$(dirname "$OUT")"
    cat "$TMP" > "$OUT"
    chmod 600 "$OUT"
    N=$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$OUT")
    echo "已写入：$OUT"
    echo "  变量 $N 个，权限 $(ls -l "$OUT" | awk '{print $1}')，大小 $(wc -c < "$OUT" | tr -d ' ') 字节"
    cd "$PROJECT_DIR"
    if git check-ignore -q "$(basename "$(dirname "$OUT")")/$(basename "$OUT")" 2>/dev/null; then
      echo "  git 状态：已忽略 ✅（不会进 commit）"
    else
      echo "  git 状态：⚠ 未被忽略 —— 先把它加进 .gitignore 再用，或用完立即 rm"
    fi
    [ -n "$DRIFT" ] && echo "  ⚠ 检测到 $DRIFT 与容器/shell 值不一致，见文件末尾审计段"
    echo "  用完请：rm \"$OUT\""
    ;;
esac
