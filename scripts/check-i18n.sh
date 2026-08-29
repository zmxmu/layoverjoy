#!/usr/bin/env bash
# 检查 Android i18n：代码中所有 L10n.t("...") 字面量 key 必须在 L10n.kt 字典中定义，
# 否则运行时会把原始 key（如 common.xxx）直接显示给用户。
# 用法：bash scripts/check-i18n.sh （CI 或提交前手动运行，存在缺失时以非零码退出）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/android/app/src/main/java"
L10N="$SRC/com/yuanhe/layoverjoy/ui/i18n/L10n.kt"

USED=$(grep -rhoE 'L10n\.t\("[a-zA-Z0-9_.]+"' "$SRC" | sed -E 's/L10n\.t\("([^"]+)"/\1/' | sort -u)
DEFINED=$(grep -oE '"[a-zA-Z0-9_.]+(\.[a-zA-Z0-9_.]+)+" to ' "$L10N" | sed -E 's/"([^"]+)" to /\1/' | sort -u)

MISSING=$(comm -23 <(echo "$USED") <(echo "$DEFINED"))
if [[ -n "$MISSING" ]]; then
  echo "❌ 以下 i18n key 在代码中使用但 L10n.kt 未定义（会把原始 key 显示给用户）："
  echo "$MISSING"
  exit 1
fi
echo "✅ i18n 检查通过：$(echo "$USED" | wc -l | tr -d ' ') 个 key 全部已定义"
